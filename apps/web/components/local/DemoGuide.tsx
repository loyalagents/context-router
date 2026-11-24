'use client';

export default function DemoGuide() {
  const prompts = [
    'Search preferences using the literal prefixes travel.demo001. and home.demo001. These are historical 2024–2025 memories; do not assume dates or bookings are current.',
    'Search with the prefix travel.demo001. and propose one change to a returned preference. Wait for my explicit approval before writing it, then confirm the stored value.',
    'In a fresh Claude Code conversation, read the exact changed slug again and report the current stored value.',
    'Search using the literal prefixes health.demo001. and finance.demo001. Report what the tools permit; do not guess or infer restricted values.',
    'Review the changed memory’s Last changed field and Activity → Context changes. Compare the original importer event with the later agent change and Assistant access event.',
  ];
  return <details className="demo-walkthrough rounded border p-5">
    <summary className="cursor-pointer font-semibold">Demo walkthrough (optional)</summary>
    <div className="mt-4 space-y-6">
    <p>The sample contains historical memories. Read by category prefix because one response is limited to 100 results. The current permissions and history views show real stored state, including your changes.</p>
    <p>Open Connections, choose Codex or Claude Code, then open your project. Codex starts with write and field-management access; Claude Code starts as a reader with health and finance restrictions. Review access shows their current permissions. Each Open starts a fresh chat, so several can stay open. Start fresh chats after restarting Context Router, switching modes or resetting the sample.</p>
    <ol className="list-decimal pl-6 space-y-5">{prompts.map((prompt, index) => <li key={prompt}>
      <p>{prompt}</p><button type="button" className="mt-1 text-blue-700 underline" onClick={() => void navigator.clipboard.writeText(prompt)}>Copy step {index + 1} prompt</button>
    </li>)}</ol>
    <p className="text-sm text-gray-600">Use sensitive-value reveal deliberately in history. A denied read is evidence of the active grants, while an empty allowed read can mean no matching memories.</p>
    </div>
  </details>;
}
