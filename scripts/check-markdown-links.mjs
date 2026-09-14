#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;
const decoder = new TextDecoder('utf-8', { fatal: true });
const FINDING_REASONS = new Set([
  'absolute-posix-target',
  'absolute-windows-target',
  'file-url-target',
  'home-relative-target',
  'invalid-target-encoding',
  'missing-target',
  'source-outside-repository',
  'target-case-mismatch',
  'target-control-character',
  'target-outside-repository',
  'unc-target',
]);
const BASELINE_REASONS = new Set([
  'absolute-posix-target',
  'absolute-windows-target',
  'file-url-target',
  'home-relative-target',
  'invalid-target-encoding',
  'target-control-character',
  'unc-target',
]);

function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isEscaped(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function escapesAsciiPunctuation(text, index) {
  return (
    text[index] === '\\' &&
    !isEscaped(text, index) &&
    /^[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]$/.test(
      text[index + 1] ?? '',
    )
  );
}

function fenceMarker(content) {
  const match = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return { run: match[1], trailing: match[2] };
}

function stripIndent(line, width) {
  let consumed = 0;
  let index = 0;
  while (index < line.length && consumed < width) {
    if (line[index] === ' ') {
      consumed += 1;
      index += 1;
      continue;
    }
    if (line[index] === '\t') {
      consumed += 4 - (consumed % 4);
      index += 1;
      continue;
    }
    break;
  }
  return consumed >= width ? line.slice(index) : null;
}

function stripBlockquoteMarker(line) {
  const marker = line.match(/^( {0,3})>/);
  if (!marker) return null;

  const markerEnd = marker[0].length;
  const following = line[markerEnd];
  if (following === ' ') return line.slice(markerEnd + 1);
  if (following !== '\t') return line.slice(markerEnd);

  const columnAfterMarker = marker[1].length + 1;
  const tabWidth = 4 - (columnAfterMarker % 4);
  return `${' '.repeat(tabWidth - 1)}${line.slice(markerEnd + 1)}`;
}

function parseDirectContainers(line) {
  const containers = [];
  let content = line;
  while (true) {
    const blockquoteContent = stripBlockquoteMarker(content);
    if (blockquoteContent !== null) {
      containers.push({ type: 'blockquote' });
      content = blockquoteContent;
      continue;
    }

    const list = content.match(/^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/);
    if (!list) break;
    const leading = list[1];
    const marker = list[2];
    const whitespace = list[3];
    let column = leading.length + marker.length;
    let expandedWhitespace = '';
    for (const character of whitespace) {
      const width = character === '\t' ? 4 - (column % 4) : 1;
      expandedWhitespace += ' '.repeat(width);
      column += width;
    }
    const padding = expandedWhitespace.length > 4 ? 1 : expandedWhitespace.length;
    containers.push({
      type: 'list',
      indent: leading.length + marker.length + padding,
    });
    content =
      expandedWhitespace.length > 4
        ? `${expandedWhitespace.slice(1)}${list[4]}`
        : list[4];
  }
  return { containers, content };
}

function contentWithinContainers(line, containers) {
  if (line.trim() === '') return '';
  let content = line;
  for (const container of containers) {
    if (container.type === 'blockquote') {
      content = stripBlockquoteMarker(content);
      if (content === null) return null;
      continue;
    }
    content = stripIndent(content, container.indent);
    if (content === null) return null;
  }
  return content;
}

function parseContainers(line, continuationContext) {
  if (line.trim() === '' && continuationContext) {
    return { containers: continuationContext, content: '' };
  }
  if (continuationContext) {
    const continued = contentWithinContainers(line, continuationContext);
    if (continued !== null) {
      const nested = parseDirectContainers(continued);
      return {
        containers: [...continuationContext, ...nested.containers],
        content: nested.content,
      };
    }
  }
  return parseDirectContainers(line);
}

const HTML_BLOCK_TAGS = [
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
].join('|');
const HTML_TYPE_6 = new RegExp(
  `^ {0,3}</?(?:${HTML_BLOCK_TAGS})(?:[ \\t]+|/?>|$)`,
  'i',
);
const HTML_ATTRIBUTE_NAME = '[A-Za-z_:][A-Za-z0-9_.:-]*';
const HTML_ATTRIBUTE_VALUE = '(?:[^\\s"\'=<>\\x60]+|"[^"]*"|\'[^\']*\')';
const HTML_ATTRIBUTE = `[ \\t]+${HTML_ATTRIBUTE_NAME}(?:[ \\t]*=[ \\t]*${HTML_ATTRIBUTE_VALUE})?`;
const HTML_TYPE_7 = new RegExp(
  `^ {0,3}(?:</[A-Za-z][A-Za-z0-9-]*[ \\t]*>|<[A-Za-z][A-Za-z0-9-]*(?:${HTML_ATTRIBUTE})*[ \\t]*/?>)[ \\t]*\\r?$`,
);
const HTML_INLINE_TAG = new RegExp(
  `^(?:</[A-Za-z][A-Za-z0-9-]*[ \\t]*>|<[A-Za-z][A-Za-z0-9-]*(?:${HTML_ATTRIBUTE})*[ \\t]*/?>)`,
);

function htmlBlockStart(content, { allowType7 = false } = {}) {
  let match = content.match(
    /^ {0,3}<(script|pre|style|textarea)(?:[ \t]+|>|$)/i,
  );
  if (match) return { type: 1 };
  if (/^ {0,3}<!--/.test(content)) return { type: 2 };
  if (/^ {0,3}<\?/.test(content)) return { type: 3 };
  if (/^ {0,3}<![A-Z]/.test(content)) return { type: 4 };
  if (/^ {0,3}<!\[CDATA\[/.test(content)) return { type: 5 };
  if (HTML_TYPE_6.test(content)) return { type: 6 };
  if (allowType7 && HTML_TYPE_7.test(content)) return { type: 7 };
  return null;
}

function htmlBlockEnds(block, content) {
  if (block.type === 1) {
    return /<\/(?:script|pre|style|textarea)[ \t]*>/i.test(content);
  }
  if (block.type === 2) return content.includes('-->');
  if (block.type === 3) return content.includes('?>');
  if (block.type === 4) return content.includes('>');
  if (block.type === 5) return content.includes(']]>');
  return content.trim() === '';
}

function startsMarkdownBlock(line) {
  const marker = fenceMarker(line);
  const startsFence =
    marker !== null &&
    !(marker.run[0] === '`' && marker.trailing.includes('`'));
  return (
    /^[ \t]*\r?$/.test(line) ||
    /^ {0,3}(?:#{1,6}(?:[ \t]+|$)|>|(?:[-+*]|1[.)])(?:[ \t]+|$))/.test(
      line,
    ) ||
    startsFence ||
    /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})\r?$/.test(
      line,
    ) ||
    /^ {0,3}(?:=+|-+)[ \t]*\r?$/.test(line) ||
    htmlBlockStart(line) !== null
  );
}

function markdownBlockBoundaryOffsets(markdown) {
  const boundaries = new Set();
  const lines = markdown.split('\n');
  let continuationContext = null;
  let offset = 0;

  for (const line of lines) {
    const { containers, content } = parseContainers(
      line,
      continuationContext,
    );
    if (startsMarkdownBlock(line) || startsMarkdownBlock(content)) {
      boundaries.add(offset);
    }
    if (containers.some(({ type }) => type === 'list')) {
      continuationContext = containers;
    } else if (line.trim() !== '') {
      continuationContext = null;
    }
    offset += line.length + 1;
  }
  return boundaries;
}

function isMarkdownBlockBoundary(text, lineStart, blockBoundaries) {
  if (blockBoundaries) return blockBoundaries.has(lineStart);
  const lineEnd = text.indexOf('\n', lineStart);
  return startsMarkdownBlock(
    text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd),
  );
}

function protectedInlineConstructEnd(text, index, blockBoundaries = null) {
  if (text[index] === '[' && !isEscaped(text, index)) {
    const closingBracket = findClosingBracket(text, index + 1, {
      stopAtBlockBoundary: true,
      blockBoundaries,
    });
    if (closingBracket !== -1 && text[closingBracket + 1] === '(') {
      if (
        inspectNestedInlineSyntax(
          text,
          index + 1,
          closingBracket,
          blockBoundaries,
        )
          .hasNestedLink
      ) {
        return null;
      }
      const parsed = parseInlineDestination(
        text,
        closingBracket + 2,
        blockBoundaries,
      );
      if (parsed?.target) return parsed.end + 1;
    }
  }
  return protectedAngleConstructEnd(text, index);
}

function protectedAngleConstructEnd(text, index) {
  if (text[index] !== '<' || isEscaped(text, index)) return null;

  const autolink = parseAutolink(text, index);
  if (autolink) return autolink.end;
  const remainder = text.slice(index);
  const tag = remainder.match(HTML_INLINE_TAG);
  if (tag) return index + tag[0].length;

  for (const [opening, closing] of [
    ['<!--', '-->'],
    ['<?', '?>'],
    ['<![CDATA[', ']]>'],
  ]) {
    if (!remainder.startsWith(opening)) continue;
    const closingIndex = remainder.indexOf(closing, opening.length);
    return closingIndex === -1
      ? null
      : index + closingIndex + closing.length;
  }
  const declaration = remainder.match(/^<![A-Z][^>]*>/);
  return declaration ? index + declaration[0].length : null;
}

function codeSpanEnd(text, index, blockBoundaries = null) {
  if (text[index] !== '`' || isEscaped(text, index)) return null;
  let runLength = 1;
  while (text[index + runLength] === '`') runLength += 1;

  let closing = index + runLength;
  while (closing < text.length) {
    if (
      text[closing] === '\n' &&
      isMarkdownBlockBoundary(text, closing + 1, blockBoundaries)
    ) {
      return null;
    }
    if (text[closing] !== '`') {
      closing += 1;
      continue;
    }
    let closingLength = 1;
    while (text[closing + closingLength] === '`') closingLength += 1;
    if (closingLength === runLength) return closing + closingLength;
    closing += closingLength;
  }
  return null;
}

function parseAutolink(text, index) {
  if (text[index] !== '<' || isEscaped(text, index)) return null;
  const match = text.slice(index).match(/^<([^<>\s]+)>/);
  if (!match) return null;
  const kind = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(match[1])
    ? 'uri'
    : /^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(match[1])
      ? 'email'
      : null;
  return kind
    ? { target: match[1], kind, end: index + match[0].length }
    : null;
}

function maskCode(markdown, blockBoundaries) {
  const sourceLines = markdown.split('\n');
  const lineOffsets = [];
  let sourceOffset = 0;
  for (const line of sourceLines) {
    lineOffsets.push(sourceOffset);
    sourceOffset += line.length + 1;
  }
  let fence = null;
  let htmlBlock = null;
  let continuationContext = null;
  let mayStartType7 = true;
  let referenceBlockEnd = -1;
  const protectedReferenceRanges = [];
  const fenceMasked = sourceLines
    .map((line, lineIndex) => {
      if (lineIndex <= referenceBlockEnd) {
        mayStartType7 = lineIndex === referenceBlockEnd;
        return line;
      }
      if (fence) {
        if (
          line.trim() === '' &&
          fence.containers.some(({ type }) => type === 'blockquote')
        ) {
          fence = null;
          mayStartType7 = true;
          return ' '.repeat(line.length);
        }
        const content = contentWithinContainers(line, fence.containers);
        if (content === null) {
          fence = null;
          mayStartType7 = true;
        } else {
          const marker = fenceMarker(content);
          if (
            marker &&
            marker.run[0] === fence.character &&
            marker.run.length >= fence.length &&
            marker.trailing.trim() === ''
          ) {
            fence = null;
          }
          mayStartType7 = fence === null;
          return ' '.repeat(line.length);
        }
      }

      if (htmlBlock) {
        if (
          line.trim() === '' &&
          htmlBlock.containers.some(({ type }) => type === 'blockquote')
        ) {
          htmlBlock = null;
          mayStartType7 = true;
          return ' '.repeat(line.length);
        }
        const content = contentWithinContainers(
          line,
          htmlBlock.containers,
        );
        if (content === null) {
          htmlBlock = null;
          mayStartType7 = true;
        } else {
          if (htmlBlockEnds(htmlBlock, content)) htmlBlock = null;
          mayStartType7 = htmlBlock === null;
          return ' '.repeat(line.length);
        }
      }

      const parsed = parseContainers(line, continuationContext);
      const { containers, content } = parsed;
      if (containers.some(({ type }) => type === 'list')) {
        continuationContext = containers;
      } else if (line.trim() !== '') {
        continuationContext = null;
      }

      const startedHtmlBlock = htmlBlockStart(content, {
        allowType7: mayStartType7,
      });
      if (startedHtmlBlock) {
        htmlBlock = htmlBlockEnds(startedHtmlBlock, content)
          ? null
          : { ...startedHtmlBlock, containers };
        mayStartType7 = htmlBlock === null;
        return ' '.repeat(line.length);
      }

      if (mayStartType7) {
        const definition = parseReferenceDefinition(
          sourceLines,
          lineIndex,
          containers,
          content,
        );
        if (definition) {
          referenceBlockEnd = definition.endLine;
          protectedReferenceRanges.push({
            start: lineOffsets[lineIndex],
            end:
              lineOffsets[definition.endLine] +
              sourceLines[definition.endLine].length,
          });
          mayStartType7 = lineIndex === referenceBlockEnd;
          return line;
        }
      }

      const marker = fenceMarker(content);
      const hasValidInfoString =
        marker && !(marker.run[0] === '`' && marker.trailing.includes('`'));
      if (hasValidInfoString) {
        fence = {
          character: marker.run[0],
          length: marker.run.length,
          containers,
        };
        mayStartType7 = false;
        return ' '.repeat(line.length);
      }

      mayStartType7 = line.trim() === '' || startsMarkdownBlock(content);
      return line;
    })
    .join('\n');

  const characters = fenceMasked.split('');
  let index = 0;
  let referenceRangeIndex = 0;
  while (index < characters.length) {
    while (
      protectedReferenceRanges[referenceRangeIndex]?.end <= index
    ) {
      referenceRangeIndex += 1;
    }
    const referenceRange = protectedReferenceRanges[referenceRangeIndex];
    if (
      referenceRange &&
      index >= referenceRange.start &&
      index < referenceRange.end
    ) {
      index = referenceRange.end;
      continue;
    }
    const protectedEnd = protectedInlineConstructEnd(
      fenceMasked,
      index,
      blockBoundaries,
    );
    if (protectedEnd !== null) {
      index = protectedEnd;
      continue;
    }
    if (characters[index] !== '`' || isEscaped(fenceMasked, index)) {
      index += 1;
      continue;
    }
    let runLength = 1;
    while (characters[index + runLength] === '`') runLength += 1;
    let closing = index + runLength;
    let blockBoundary = false;
    while (closing < characters.length) {
      if (characters[closing] === '\n') {
        const nextLineStart = closing + 1;
        const nextLineEnd = fenceMasked.indexOf('\n', nextLineStart);
        const nextLine = fenceMasked.slice(
          nextLineStart,
          nextLineEnd === -1 ? fenceMasked.length : nextLineEnd,
        );
        if (
          isMarkdownBlockBoundary(
            fenceMasked,
            nextLineStart,
            blockBoundaries,
          )
        ) {
          blockBoundary = true;
          break;
        }
      }
      if (characters[closing] !== '`') {
        closing += 1;
        continue;
      }
      let closingLength = 1;
      while (characters[closing + closingLength] === '`') closingLength += 1;
      if (closingLength === runLength) break;
      closing += closingLength;
    }
    if (blockBoundary || closing >= characters.length) {
      index += runLength;
      continue;
    }
    for (let cursor = index; cursor < closing + runLength; cursor += 1) {
      if (characters[cursor] !== '\n') characters[cursor] = ' ';
    }
    index = closing + runLength;
  }
  return characters.join('');
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === '\n') line += 1;
  }
  return line;
}

function findClosingBracket(
  text,
  start,
  { stopAtBlockBoundary = false, blockBoundaries = null } = {},
) {
  let depth = 1;
  for (let index = start; index < text.length; index += 1) {
    if (stopAtBlockBoundary && text[index] === '\n') {
      const nextLineStart = index + 1;
      if (
        isMarkdownBlockBoundary(text, nextLineStart, blockBoundaries)
      ) {
        return -1;
      }
    }
    if (escapesAsciiPunctuation(text, index)) {
      index += 1;
      continue;
    }
    const protectedEnd =
      codeSpanEnd(text, index, blockBoundaries) ??
      protectedAngleConstructEnd(text, index);
    if (protectedEnd !== null) {
      index = protectedEnd - 1;
      continue;
    }
    if (text[index] === '[') depth += 1;
    if (text[index] === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function inspectNestedInlineSyntax(
  text,
  labelStart,
  labelEnd,
  blockBoundaries = null,
) {
  const images = [];
  for (let index = labelStart; index < labelEnd; index += 1) {
    if (text[index] !== '[' || isEscaped(text, index)) continue;
    const closingBracket = findClosingBracket(text, index + 1, {
      stopAtBlockBoundary: true,
      blockBoundaries,
    });
    if (
      closingBracket === -1 ||
      closingBracket >= labelEnd ||
      text[closingBracket + 1] !== '('
    ) {
      continue;
    }
    const parsed = parseInlineDestination(
      text,
      closingBracket + 2,
      blockBoundaries,
    );
    if (!parsed?.target || parsed.end >= labelEnd) continue;

    const isImage =
      index > 0 && text[index - 1] === '!' && !isEscaped(text, index - 1);
    if (!isImage) return { hasNestedLink: true, images: [] };
    images.push({
      target: parsed.target,
      line: lineNumberAt(text, index),
    });
    index = parsed.end;
  }
  return { hasNestedLink: false, images };
}

function unescapeMarkdown(value) {
  return value.replace(
    /\\([\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e])/g,
    '$1',
  );
}

function consumeInlineWhitespace(text, start) {
  let index = start;
  let lineEndings = 0;
  while (index < text.length) {
    if (text[index] === ' ' || text[index] === '\t') {
      index += 1;
      continue;
    }
    if (text[index] === '\n' || text[index] === '\r') {
      lineEndings += 1;
      if (lineEndings > 1) return null;
      if (text[index] === '\r' && text[index + 1] === '\n') index += 1;
      index += 1;
      continue;
    }
    break;
  }
  return { index, consumed: index > start };
}

function finishInlineLink(text, start, target, blockBoundaries = null) {
  let index = start;
  if (text[index] === ')') return { target, end: index };

  const leadingWhitespace = consumeInlineWhitespace(text, index);
  if (!leadingWhitespace?.consumed) return null;
  index = leadingWhitespace.index;
  if (text[index] === ')') return { target, end: index };

  const opener = text[index];
  const closer = opener === '(' ? ')' : opener;
  if (opener !== '"' && opener !== "'" && opener !== '(') return null;
  index += 1;
  while (index < text.length) {
    if (escapesAsciiPunctuation(text, index)) {
      index += 2;
      continue;
    }
    if (text[index] === '\n' || text[index] === '\r') {
      let next = index + 1;
      if (text[index] === '\r' && text[next] === '\n') next += 1;
      const nextLineEnd = text.indexOf('\n', next);
      const nextLine = text.slice(
        next,
        nextLineEnd === -1 ? text.length : nextLineEnd,
      );
      if (
        isMarkdownBlockBoundary(text, next, blockBoundaries)
      ) {
        return null;
      }
    }
    if (text[index] === opener && opener === '(') return null;
    if (text[index] === closer) break;
    index += 1;
  }
  if (text[index] !== closer) return null;
  index += 1;
  const trailingWhitespace = consumeInlineWhitespace(text, index);
  if (trailingWhitespace === null) return null;
  return text[trailingWhitespace.index] === ')'
    ? { target, end: trailingWhitespace.index }
    : null;
}

function parseInlineDestination(text, start, blockBoundaries = null) {
  const leadingWhitespace = consumeInlineWhitespace(text, start);
  if (leadingWhitespace === null) return null;
  let index = leadingWhitespace.index;

  if (text[index] === '<') {
    const destinationStart = index + 1;
    index += 1;
    while (index < text.length) {
      if (escapesAsciiPunctuation(text, index)) {
        index += 2;
        continue;
      }
      if (text[index] === '>') break;
      if (text[index] === '\n' || text[index] === '\r') return null;
      index += 1;
    }
    if (text[index] !== '>') return null;
    const target = unescapeMarkdown(text.slice(destinationStart, index));
    return finishInlineLink(text, index + 1, target, blockBoundaries);
  }

  const destinationStart = index;
  let depth = 0;
  for (; index < text.length; index += 1) {
    const character = text[index];
    if (escapesAsciiPunctuation(text, index)) {
      index += 1;
      continue;
    }
    if (character === '(') {
      depth += 1;
      continue;
    }
    if ((character === '\n' || character === '\r') && depth > 0) {
      return null;
    }
    if (character === ')') {
      if (depth === 0) {
        return {
          target: unescapeMarkdown(text.slice(destinationStart, index)),
          end: index,
        };
      }
      depth -= 1;
      continue;
    }
    if (/[ \t\n\r]/.test(character) && depth === 0) {
      return finishInlineLink(
        text,
        index,
        unescapeMarkdown(text.slice(destinationStart, index)),
        blockBoundaries,
      );
    }
  }
  return null;
}

function parseReferenceDestination(remainder) {
  let start = 0;
  while (start < remainder.length && /[ \t]/.test(remainder[start])) {
    start += 1;
  }
  if (start === remainder.length) return null;
  if (remainder[start] === '<') {
    let index = start + 1;
    while (index < remainder.length) {
      if (escapesAsciiPunctuation(remainder, index)) {
        index += 2;
        continue;
      }
      if (remainder[index] === '>') {
        return {
          target: unescapeMarkdown(remainder.slice(start + 1, index)),
          end: index + 1,
        };
      }
      index += 1;
    }
    return null;
  }
  let index = start;
  while (index < remainder.length && !/[ \t]/.test(remainder[index])) {
    if (escapesAsciiPunctuation(remainder, index)) index += 1;
    index += 1;
  }
  return {
    target: unescapeMarkdown(remainder.slice(start, index)),
    end: index,
  };
}

function referenceTitleEnd(
  lines,
  lineIndex,
  containers,
  remainder,
  destinationEnd,
) {
  const afterDestination = remainder.slice(destinationEnd);
  const opening = afterDestination.match(/^[ \t]+(["'(])/);
  if (!opening) return lineIndex;

  const opener = opening[1];
  const closer = opener === '(' ? ')' : opener;
  let content = afterDestination.slice(opening[0].length);
  let titleEndLine = lineIndex;
  while (true) {
    for (let index = 0; index < content.length; index += 1) {
      if (escapesAsciiPunctuation(content, index)) {
        index += 1;
        continue;
      }
      if (content[index] !== closer) continue;
      return content.slice(index + 1).trim() === ''
        ? titleEndLine
        : lineIndex;
    }

    const nextLineIndex = titleEndLine + 1;
    if (lines[nextLineIndex] === undefined) return lineIndex;
    const continuation = parseContainers(lines[nextLineIndex], containers);
    if (
      !sameContainers(continuation.containers, containers) ||
      continuation.content.trim() === ''
    ) {
      return lineIndex;
    }
    titleEndLine = nextLineIndex;
    content = continuation.content;
  }
}

function sameContainers(left, right) {
  return (
    left.length === right.length &&
    left.every(
      (container, index) =>
        container.type === right[index].type &&
        container.indent === right[index].indent,
    )
  );
}

function parseReferenceDefinition(lines, lineIndex, containers, content) {
  const opener = content.match(/^ {0,3}\[/);
  if (!opener) return null;

  const openIndex = opener[0].length - 1;
  let definitionContent = content;
  let definitionEndLine = lineIndex;
  let closing = findClosingBracket(definitionContent, openIndex + 1);
  while (
    closing === -1 &&
    definitionContent.length <= 999 &&
    lines[definitionEndLine + 1] !== undefined
  ) {
    const continuation = parseContainers(
      lines[definitionEndLine + 1],
      containers,
    );
    if (
      !sameContainers(continuation.containers, containers) ||
      continuation.content.trim() === ''
    ) {
      break;
    }
    definitionContent += `\n${continuation.content}`;
    definitionEndLine += 1;
    closing = findClosingBracket(definitionContent, openIndex + 1);
  }

  let remainder =
    closing !== -1 && definitionContent[closing + 1] === ':'
      ? definitionContent.slice(closing + 2)
      : null;
  if (remainder === null) return null;

  let targetLine = definitionEndLine + 1;
  if (
    remainder.trim() === '' &&
    lines[definitionEndLine + 1] !== undefined
  ) {
    const nextLine = parseContainers(
      lines[definitionEndLine + 1],
      containers,
    );
    if (
      sameContainers(nextLine.containers, containers) &&
      nextLine.content.trim() !== ''
    ) {
      remainder = nextLine.content;
      definitionEndLine += 1;
      targetLine += 1;
    }
  }
  const destination = parseReferenceDestination(remainder);
  if (destination) {
    definitionEndLine = referenceTitleEnd(
      lines,
      definitionEndLine,
      containers,
      remainder,
      destination.end,
    );
  }
  return destination
    ? {
        target: destination.target,
        targetLine,
        endLine: definitionEndLine,
      }
    : null;
}

export function extractMarkdownDestinations(markdown) {
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const blockBoundaries = markdownBlockBoundaryOffsets(normalized);
  const masked = maskCode(normalized, blockBoundaries);
  const destinations = [];

  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === '<' && !isEscaped(masked, index)) {
      const autolink = parseAutolink(masked, index);
      if (autolink?.kind === 'uri') {
        destinations.push({
          target: autolink.target,
          line: lineNumberAt(masked, index),
        });
      }
      if (autolink) index = autolink.end - 1;
      continue;
    }
    if (masked[index] !== '[' || isEscaped(masked, index)) continue;
    const closingBracket = findClosingBracket(masked, index + 1, {
      stopAtBlockBoundary: true,
      blockBoundaries,
    });
    if (closingBracket === -1 || masked[closingBracket + 1] !== '(') continue;
    const nested = inspectNestedInlineSyntax(
      masked,
      index + 1,
      closingBracket,
      blockBoundaries,
    );
    if (nested.hasNestedLink) continue;
    const parsed = parseInlineDestination(
      masked,
      closingBracket + 2,
      blockBoundaries,
    );
    if (!parsed || !parsed.target) continue;
    destinations.push(...nested.images);
    destinations.push({
      target: parsed.target,
      line: lineNumberAt(masked, index),
    });
    index = parsed.end;
  }

  const lines = masked.split('\n');
  let continuationContext = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const parsedLine = parseContainers(lines[lineIndex], continuationContext);
    const { containers, content } = parsedLine;
    if (containers.some(({ type }) => type === 'list')) {
      continuationContext = containers;
    } else if (lines[lineIndex].trim() !== '') {
      continuationContext = null;
    }

    const definition = parseReferenceDefinition(
      lines,
      lineIndex,
      containers,
      content,
    );
    if (definition) {
      destinations.push({
        target: definition.target,
        line: definition.targetLine,
      });
      lineIndex = definition.endLine;
    }
  }

  return destinations;
}

function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Git discovery failed');
  }
}

export function discoverMarkdownFiles(
  repoRoot,
  { lstatSync = fs.lstatSync } = {},
) {
  const topLevel = gitTopLevel(repoRoot);
  const requestedRoot = fs.realpathSync(repoRoot);
  const discoveredRoot = fs.realpathSync(topLevel);
  if (requestedRoot !== discoveredRoot) throw new Error('Git discovery failed');

  let output;
  try {
    output = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: discoveredRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    throw new Error('Git discovery failed');
  }

  return output
    .split('\0')
    .filter(Boolean)
    .filter((relativePath) => MARKDOWN_EXTENSION.test(relativePath))
    .filter((relativePath) => {
      try {
        const stat = lstatSync(path.join(discoveredRoot, relativePath));
        return stat.isFile() || stat.isSymbolicLink();
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
        throw error;
      }
    })
    .map(toPosix)
    .sort(bytewiseCompare);
}

function caseStatus(root, relativePath) {
  const segments = toPosix(relativePath).split('/').filter(Boolean);
  let current = root;
  for (const segment of segments) {
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return 'missing';
    }
    if (entries.includes(segment)) {
      current = path.join(current, segment);
      continue;
    }
    if (entries.some((entry) => entry.toLocaleLowerCase('en-US') === segment.toLocaleLowerCase('en-US'))) {
      return 'case-mismatch';
    }
    return 'missing';
  }
  return 'exact';
}

function makeFinding({ source, line, reason, rawTarget, safeTarget, targetKind }) {
  return {
    source,
    line,
    reason,
    ...(safeTarget ? { safeTarget } : {}),
    ...(targetKind ? { targetKind } : {}),
    fingerprintInput: `${source}\0${reason}\0${rawTarget}`,
  };
}

function filesystemPathPart(rawTarget) {
  for (let index = 0; index < rawTarget.length; index += 1) {
    if (rawTarget[index] === '?') return rawTarget.slice(0, index);
    if (rawTarget[index] !== '#') continue;
    const characterReference = rawTarget
      .slice(Math.max(0, index - 1))
      .match(/^&#(?:[0-9]+|[xX][0-9A-Fa-f]+);/);
    if (!characterReference) return rawTarget.slice(0, index);
  }
  return rawTarget;
}

function classifyLocalTarget({ repoRoot, source, line, rawTarget }) {
  if (!rawTarget || rawTarget.startsWith('#')) return null;
  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawTarget) &&
    !/^file:/i.test(rawTarget) &&
    !/^[A-Za-z]:/.test(rawTarget)
  ) {
    return null;
  }
  const pathPart = filesystemPathPart(rawTarget);
  if (!pathPart) return null;
  if (/&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/.test(pathPart)) {
    return makeFinding({
      source,
      line,
      reason: 'invalid-target-encoding',
      rawTarget,
      targetKind: 'character-reference',
    });
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return makeFinding({ source, line, reason: 'invalid-target-encoding', rawTarget, targetKind: 'invalid-encoding' });
  }
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(decoded)) {
    return makeFinding({ source, line, reason: 'target-control-character', rawTarget, targetKind: 'control-character' });
  }

  const lowered = decoded.toLocaleLowerCase('en-US');
  if (lowered.startsWith('file:')) {
    return makeFinding({ source, line, reason: 'file-url-target', rawTarget, targetKind: 'file-url' });
  }
  if (/^(?:\\\\|\/\/)/.test(decoded)) {
    return makeFinding({ source, line, reason: 'unc-target', rawTarget, targetKind: 'unc' });
  }
  if (/^[A-Za-z]:[\\/]/.test(decoded)) {
    return makeFinding({ source, line, reason: 'absolute-windows-target', rawTarget, targetKind: 'absolute-windows' });
  }
  if (decoded.startsWith('/')) {
    return makeFinding({ source, line, reason: 'absolute-posix-target', rawTarget, targetKind: 'absolute-posix' });
  }
  if (/^~(?:[\\/]|$)/.test(decoded)) {
    return makeFinding({ source, line, reason: 'home-relative-target', rawTarget, targetKind: 'home-relative' });
  }
  const sourceDirectory = path.dirname(path.join(repoRoot, source));
  const resolved = path.resolve(sourceDirectory, decoded);
  if (!isInside(repoRoot, resolved)) {
    return makeFinding({ source, line, reason: 'target-outside-repository', rawTarget, targetKind: 'repository-escape' });
  }

  const relativeTarget = toPosix(path.relative(repoRoot, resolved));
  const status = caseStatus(repoRoot, relativeTarget);
  if (status === 'case-mismatch') {
    return makeFinding({ source, line, reason: 'target-case-mismatch', rawTarget, safeTarget: relativeTarget });
  }
  if (status === 'missing') {
    return makeFinding({ source, line, reason: 'missing-target', rawTarget, safeTarget: relativeTarget });
  }

  let realTarget;
  try {
    realTarget = fs.realpathSync(resolved);
  } catch {
    return makeFinding({ source, line, reason: 'missing-target', rawTarget, safeTarget: relativeTarget });
  }
  const realRoot = fs.realpathSync(repoRoot);
  if (!isInside(realRoot, realTarget)) {
    return makeFinding({ source, line, reason: 'target-outside-repository', rawTarget, targetKind: 'external-symlink' });
  }
  return null;
}

export function findLinkViolations({ repoRoot, files }) {
  const root = fs.realpathSync(repoRoot);
  const findings = [];

  for (const source of files) {
    const sourcePath = path.resolve(root, source);
    if (!isInside(root, sourcePath)) throw new Error('Markdown source escapes repository');
    const sourceRealPath = fs.realpathSync(sourcePath);
    if (!isInside(root, sourceRealPath)) {
      findings.push(
        makeFinding({
          source,
          line: 1,
          reason: 'source-outside-repository',
          rawTarget: source,
          targetKind: 'external-symlink',
        }),
      );
      continue;
    }
    const markdown = decoder.decode(fs.readFileSync(sourceRealPath));
    findings.push(
      ...findViolationsInMarkdown({
        repoRoot: root,
        source: toPosix(source),
        markdown,
      }),
    );
  }

  return findings.sort((left, right) => {
    const sourceOrder = bytewiseCompare(left.source, right.source);
    if (sourceOrder !== 0) return sourceOrder;
    if (left.line !== right.line) return left.line - right.line;
    return bytewiseCompare(left.reason, right.reason);
  });
}

function findViolationsInMarkdown({ repoRoot, source, markdown }) {
  const findings = [];
  for (const { target, line } of extractMarkdownDestinations(markdown)) {
    const finding = classifyLocalTarget({
      repoRoot,
      source,
      line,
      rawTarget: target,
    });
    if (finding) findings.push(finding);
  }
  return findings;
}

function findingHash(finding) {
  return createHash('sha256').update(finding.fingerprintInput).digest('hex');
}

export function createBaseline(findings, baseCommit) {
  if (!/^[0-9a-f]{40}$/.test(baseCommit)) throw new Error('Baseline commit must be a full SHA');
  const countsByReason = {};
  for (const finding of findings) {
    countsByReason[finding.reason] = (countsByReason[finding.reason] ?? 0) + 1;
  }
  return {
    version: 1,
    baseCommit,
    findingCount: findings.length,
    countsByReason: Object.fromEntries(
      Object.entries(countsByReason).sort(([left], [right]) => bytewiseCompare(left, right)),
    ),
    entries: findings
      .map((finding) => ({
        hash: findingHash(finding),
        source: finding.source,
        reason: finding.reason,
      }))
      .sort((left, right) => bytewiseCompare(left.hash, right.hash)),
  };
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort(bytewiseCompare);
  const expected = [...keys].sort(bytewiseCompare);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function safeBaselineSource(source) {
  if (typeof source !== 'string' || !MARKDOWN_EXTENSION.test(source)) return false;
  const segments = source.split('/');
  return (
    source.startsWith('docs/plans/') &&
    !source.startsWith('docs/plans/active/local-migration/') &&
    !path.posix.isAbsolute(source) &&
    !source.includes('\\') &&
    !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(source) &&
    segments.every((segment) => segment && segment !== '.' && segment !== '..') &&
    path.posix.normalize(source) === source
  );
}

function baselineEntryKey({ hash, source, reason }) {
  return `${hash}\0${source}\0${reason}`;
}

function findingEntryKey(finding) {
  return baselineEntryKey({
    hash: findingHash(finding),
    source: finding.source,
    reason: finding.reason,
  });
}

function validateBaseline(baseline, expectedBaseCommit = null) {
  if (
    !hasExactKeys(baseline, [
      'version',
      'baseCommit',
      'findingCount',
      'countsByReason',
      'entries',
    ]) ||
    baseline.version !== 1 ||
    !/^[0-9a-f]{40}$/.test(baseline.baseCommit ?? '') ||
    (expectedBaseCommit !== null && baseline.baseCommit !== expectedBaseCommit) ||
    !Number.isSafeInteger(baseline.findingCount) ||
    baseline.findingCount < 0 ||
    !isPlainObject(baseline.countsByReason) ||
    !Array.isArray(baseline.entries) ||
    baseline.findingCount !== baseline.entries.length
  ) {
    throw new Error('Malformed link baseline');
  }

  const derivedCounts = {};
  for (const entry of baseline.entries) {
    if (
      !hasExactKeys(entry, ['hash', 'source', 'reason']) ||
      !/^[0-9a-f]{64}$/.test(entry.hash ?? '') ||
      !safeBaselineSource(entry.source) ||
      !FINDING_REASONS.has(entry.reason)
    ) {
      throw new Error('Malformed link baseline');
    }
    derivedCounts[entry.reason] = (derivedCounts[entry.reason] ?? 0) + 1;
  }

  const countKeys = Object.keys(baseline.countsByReason).sort(bytewiseCompare);
  const derivedKeys = Object.keys(derivedCounts).sort(bytewiseCompare);
  if (
    countKeys.length !== derivedKeys.length ||
    countKeys.some((key, index) => key !== derivedKeys[index]) ||
    countKeys.some(
      (key) =>
        !Number.isSafeInteger(baseline.countsByReason[key]) ||
        baseline.countsByReason[key] <= 0 ||
        baseline.countsByReason[key] !== derivedCounts[key],
    )
  ) {
    throw new Error('Malformed link baseline');
  }
}

export function compareWithBaseline(findings, baseline) {
  validateBaseline(baseline);
  const allowed = new Map();
  for (const entry of baseline.entries) {
    const key = baselineEntryKey(entry);
    allowed.set(key, (allowed.get(key) ?? 0) + 1);
  }
  return findings.filter((finding) => {
    const key = findingEntryKey(finding);
    const remaining = allowed.get(key) ?? 0;
    if (remaining === 0) return true;
    allowed.set(key, remaining - 1);
    return false;
  });
}

function legacyMarkdownPathsAtCommit(repoRoot, baseCommit) {
  let output;
  try {
    execFileSync('git', ['cat-file', '-e', `${baseCommit}^{commit}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    output = execFileSync(
      'git',
      ['ls-tree', '-r', '-z', '--name-only', baseCommit, '--', 'docs/plans'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    throw new Error('Unable to read link baseline commit');
  }
  return output
    .split('\0')
    .filter(Boolean)
    .map(toPosix)
    .filter((source) => MARKDOWN_EXTENSION.test(source))
    .filter(
      (source) => !source.startsWith('docs/plans/active/local-migration/'),
    );
}

export function validateBaselineAgainstBase({
  repoRoot,
  baseline,
  expectedBaseCommit,
}) {
  if (!/^[0-9a-f]{40}$/.test(expectedBaseCommit ?? '')) {
    throw new Error('Malformed link baseline');
  }
  validateBaseline(baseline, expectedBaseCommit);
  if (baseline.entries.some(({ reason }) => !BASELINE_REASONS.has(reason))) {
    throw new Error('Malformed link baseline');
  }
  const legacySources = new Set(
    legacyMarkdownPathsAtCommit(repoRoot, expectedBaseCommit),
  );
  const baselineSources = new Set(baseline.entries.map(({ source }) => source));
  const baseFindingCounts = new Map();

  for (const source of baselineSources) {
    if (!legacySources.has(source)) throw new Error('Malformed link baseline');
    let markdown;
    try {
      const blob = execFileSync('git', ['show', `${expectedBaseCommit}:${source}`], {
        cwd: repoRoot,
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      markdown = decoder.decode(blob);
    } catch {
      throw new Error('Unable to read link baseline commit');
    }
    for (const finding of findViolationsInMarkdown({
      repoRoot,
      source,
      markdown,
    })) {
      const key = findingEntryKey(finding);
      baseFindingCounts.set(key, (baseFindingCounts.get(key) ?? 0) + 1);
    }
  }

  for (const entry of baseline.entries) {
    const key = baselineEntryKey(entry);
    const remaining = baseFindingCounts.get(key) ?? 0;
    if (remaining === 0) throw new Error('Malformed link baseline');
    baseFindingCounts.set(key, remaining - 1);
  }
}

export function formatFinding(finding) {
  const sanitize = (value) => {
    let output = '';
    for (const character of String(value)) {
      if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(character)) {
        output += `\\u{${character.codePointAt(0).toString(16)}}`;
      } else if (character === '\\') {
        output += '\\\\';
      } else {
        output += character;
      }
    }
    return output;
  };
  const target = finding.safeTarget
    ? `target=${sanitize(finding.safeTarget)}`
    : `target=<${sanitize(finding.targetKind ?? 'redacted')}>`;
  return `${sanitize(finding.source)}:${finding.line} [${sanitize(finding.reason)}] ${target}`;
}

export function parseCliArgs(args) {
  const options = {
    baselinePath: null,
    expectedBaseCommit: null,
    printBaselineCommit: null,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      options.help = true;
    } else if (argument === '--baseline') {
      if (!args[index + 1]) throw new Error('--baseline requires a path');
      options.baselinePath = args[++index];
    } else if (argument === '--expected-base') {
      if (options.expectedBaseCommit !== null || !args[index + 1]) {
        throw new Error('--expected-base requires one value');
      }
      options.expectedBaseCommit = args[++index];
    } else if (argument === '--print-baseline') {
      if (!args[index + 1]) throw new Error('--print-baseline requires a full commit SHA');
      options.printBaselineCommit = args[++index];
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (options.baselinePath && options.printBaselineCommit) {
    throw new Error('--baseline and --print-baseline are mutually exclusive');
  }
  if (
    options.baselinePath &&
    !/^[0-9a-f]{40}$/.test(options.expectedBaseCommit ?? '')
  ) {
    throw new Error('--baseline requires --expected-base with a full commit SHA');
  }
  if (options.expectedBaseCommit && !options.baselinePath) {
    throw new Error('--expected-base requires --baseline');
  }
  return options;
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        'Usage: node scripts/check-markdown-links.mjs [--baseline PATH --expected-base FULL_SHA | --print-baseline FULL_SHA]',
      );
      return 0;
    }
    const repoRoot = fs.realpathSync(gitTopLevel(process.cwd()));
    const files = discoverMarkdownFiles(repoRoot);
    const findings = findLinkViolations({ repoRoot, files });

    if (options.printBaselineCommit) {
      const baseline = createBaseline(findings, options.printBaselineCommit);
      validateBaselineAgainstBase({
        repoRoot,
        baseline,
        expectedBaseCommit: options.printBaselineCommit,
      });
      console.log(JSON.stringify(baseline, null, 2));
      return 0;
    }

    for (const finding of findings) console.log(formatFinding(finding));
    if (options.baselinePath) {
      const baseline = JSON.parse(fs.readFileSync(path.resolve(repoRoot, options.baselinePath), 'utf8'));
      validateBaselineAgainstBase({
        repoRoot,
        baseline,
        expectedBaseCommit: options.expectedBaseCommit,
      });
      const unexpected = compareWithBaseline(findings, baseline);
      if (unexpected.length > 0) {
        console.error(`Markdown link check found ${unexpected.length} unexpected violation(s).`);
        return 1;
      }
      console.log(`Markdown link baseline check passed (${findings.length} known violation(s), 0 unexpected).`);
      return 0;
    }

    if (findings.length > 0) {
      console.error(`Markdown link check found ${findings.length} violation(s).`);
      return 1;
    }
    console.log(`Markdown link check passed (${files.length} Markdown files).`);
    return 0;
  } catch {
    console.error('Markdown link check failed due to an operational or configuration error.');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
