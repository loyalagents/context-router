'use client';

import { useState } from 'react';
import AuditHistoryTab from '../preferences/components/AuditHistoryTab';
import McpAccessHistoryTab from './McpAccessHistoryTab';

interface HistoryTabsProps {
  accessToken: string;
  preferenceDefinitions: Array<{
    slug: string;
    isSensitive: boolean;
  }>;
}

export default function HistoryTabs({
  accessToken,
  preferenceDefinitions,
}: HistoryTabsProps) {
  const [activeTab, setActiveTab] = useState<'audit' | 'mcp'>('audit');

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            activeTab === 'audit'
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Audit
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mcp')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            activeTab === 'mcp'
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          MCP Access
        </button>
      </div>

      <div className={activeTab === 'audit' ? 'block' : 'hidden'}>
        <AuditHistoryTab
          accessToken={accessToken}
          preferenceDefinitions={preferenceDefinitions}
          shouldLoad={activeTab === 'audit'}
          showHeader={false}
        />
      </div>

      <div className={activeTab === 'mcp' ? 'block' : 'hidden'}>
        <McpAccessHistoryTab
          accessToken={accessToken}
          shouldLoad={activeTab === 'mcp'}
        />
      </div>
    </div>
  );
}
