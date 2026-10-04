'use client';

import { useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import {
  localFileMime,
  operationFailure,
  reviewLocalFile,
  validateLocalFile,
} from '@/lib/local-upload';
import { AiControls, useAiOperation } from './AiControls';
import type {
  DocumentAnalysisResult,
  UploadBatchFileResult,
  UploadBatchResult,
} from '@/app/dashboard/preferences/types';

export default function LocalDocumentUpload({
  onAnalysisComplete,
}: {
  onAnalysisComplete: (result: UploadBatchResult) => void;
}) {
  const operation = useAiOperation('analysis');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<UploadBatchFileResult[]>([]);
  const files = useRef(new Map<string, File>());
  useEffect(() => {
    const owner = files;
    return () => owner.current.clear();
  }, []);
  const policy = operation.session!.capabilities.operations.analysis;
  const upload = async (selected: File[]) => {
    if (
      !consent ||
      operation.pending ||
      !operation.available ||
      selected.length === 0
    )
      return;
    if (selected.length > 10) {
      setError('Upload up to 10 files at a time.');
      return;
    }
    setError('');
    const request = operation.begin();
    const batchFiles = new Map<string, File>();
    files.current = batchFiles;
    const records: UploadBatchFileResult[] = selected.map((file, index) => {
      const id = String(index),
        invalid = validateLocalFile(file, policy);
      if (!invalid) batchFiles.set(id, file);
      return {
        id,
        fileName: file.name,
        fileSize: file.size,
        status: invalid ? 'validation_error' : 'queued',
        error: invalid ?? undefined,
      };
    });
    selected.length = 0;
    const publish = () => {
      if (operation.isCurrent(request.controller))
        setQueue(records.map((record) => ({ ...record })));
    };
    publish();
    try {
      for (const record of records) {
        if (!operation.isCurrent(request.controller) || request.signal.aborted)
          break;
        let file = batchFiles.get(record.id);
        if (!file) continue;
        record.status = 'analyzing';
        publish();
        try {
          if (!(await reviewLocalFile(file, policy, request.signal)))
            throw new Error('Upload cancelled during secret review.');
          request.signal.throwIfAborted();
          const form = new FormData();
          form.append(
            'file',
            file.type === localFileMime(file)
              ? file
              : new Blob([file], { type: localFileMime(file) }),
            file.name,
          );
          const response = await authenticatedFetch(
            '/api/preferences/analysis',
            {
              method: 'POST',
              body: form,
              headers: request.headers,
              signal: request.signal,
            },
          );
          if (!response.ok)
            throw new Error(
              response.status === 504
                ? 'Operation deadline reached. Check model status.'
                : 'Upload rejected. Check the file and model status.',
            );
          const result: DocumentAnalysisResult = await response.json();
          request.signal.throwIfAborted();
          if (!operation.isCurrent(request.controller)) return;
          record.result = result;
          record.status = result.status;
          record.error = result.statusReason ?? undefined;
        } catch (cause) {
          record.status = 'upload_error';
          record.error = operationFailure(cause, request.signal);
        } finally {
          batchFiles.delete(record.id);
          file = undefined;
        }
        publish();
        if (request.signal.aborted || record.result?.status === 'ai_error') {
          for (const waiting of records)
            if (waiting.status === 'queued') {
              waiting.status = 'upload_error';
              waiting.error =
                'Batch stopped. Check model status before selecting files again.';
            }
          break;
        }
      }
      if (operation.isCurrent(request.controller)) {
        if (request.signal.aborted) {
          setQueue([]);
          setError(operationFailure(undefined, request.signal));
        } else onAnalysisComplete({ files: records });
      }
    } finally {
      batchFiles.clear();
      operation.finish(request.controller);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Supported by this runtime:{' '}
        {policy.mimeTypes.length ? policy.mimeTypes.join(', ') : 'none'}.
        Maximum {Math.floor(policy.maxFileSizeBytes / 1024 / 1024)} MB per file;
        up to 10 files. PDFs must contain extractable text. Images and OCR are
        unavailable.
      </p>
      <p className="text-sm text-gray-600">
        Raw files stay in memory for this operation and are released afterward.
        Review proposals before saving; accepted values and evidence become
        memory and history.
      </p>
      <label className="block text-sm">
        <input
          type="checkbox"
          checked={consent}
          disabled={operation.pending}
          onChange={(e) => setConsent(e.target.checked)}
        />{' '}
        I reviewed the files and consent to sending their contents to the local
        model.
      </label>
      <label className="block border-2 border-dashed rounded-lg p-8 text-center">
        Choose documents
        <input
          aria-label="Choose documents"
          className="block mt-2"
          type="file"
          multiple
          accept={policy.mimeTypes.join(',')}
          disabled={!consent || !operation.available || operation.pending}
          onChange={(e) => {
            const selected = Array.from(e.target.files ?? []);
            e.target.value = '';
            void upload(selected);
          }}
        />
      </label>
      <AiControls
        operation={operation}
        onCancel={() => {
          files.current.clear();
          setQueue([]);
          setError(
            'Operation cancelled. Files released; check model status before continuing.',
          );
        }}
      />
      {queue.length > 0 && (
        <ul aria-live="polite">
          {queue.map((file) => (
            <li key={file.id}>
              {file.fileName}: {file.status}
              {file.error ? ` — ${file.error}` : ''}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
