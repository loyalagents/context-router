'use client';

import { useState, useCallback, useRef } from 'react';

interface PreferenceSuggestion {
  id: string;
  slug: string;
  operation: 'CREATE' | 'UPDATE';
  oldValue: any;
  newValue: any;
  confidence: number;
  sourceSnippet: string;
  sourceMeta?: {
    page?: number;
    line?: number;
  };
  wasCorrected?: boolean;
  category?: string;
  description?: string;
}

type FilterReason = 'MISSING_FIELDS' | 'DUPLICATE_KEY' | 'NO_CHANGE' | 'UNKNOWN_SLUG';

interface FilteredSuggestion extends PreferenceSuggestion {
  filterReason: FilterReason;
  filterDetails?: string;
}

interface DocumentAnalysisResult {
  analysisId: string;
  suggestions: PreferenceSuggestion[];
  filteredSuggestions: FilteredSuggestion[];
  documentSummary: string | null;
  status: 'success' | 'no_matches' | 'parse_error' | 'ai_error';
  statusReason: string | null;
  filteredCount?: number;
}

interface DocumentUploadProps {
  onAnalysisComplete: (result: DocumentAnalysisResult) => void;
  accessToken: string;
}

const ALLOWED_TYPES = [
  'text/plain',
  'application/json',
  'application/pdf',
  'image/png',
  'image/jpeg',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export default function DocumentUpload({
  onAnalysisComplete,
  accessToken,
}: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `Unsupported file type: ${file.type}. Allowed: PDF, PNG, JPEG, TXT, JSON`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 10MB`;
    }
    return null;
  };

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setIsUploading(true);

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      setIsUploading(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
      const response = await fetch(`${backendUrl}/api/preferences/analysis`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Upload failed: ${response.statusText}`);
      }

      const result: DocumentAnalysisResult = await response.json();
      onAnalysisComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [accessToken, onAnalysisComplete]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        uploadFile(file);
      }
    },
    [uploadFile]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full">
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${isUploading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />

        {isUploading ? (
          <div className="space-y-3">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-gray-600">Analyzing document...</p>
            <p className="text-sm text-gray-400">This may take a moment</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="w-12 h-12 mx-auto text-gray-400">
              <svg
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                className="w-full h-full"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <div>
              <p className="text-gray-600">
                <span className="text-blue-600 font-medium">Click to upload</span> or drag
                and drop
              </p>
              <p className="text-sm text-gray-400 mt-1">
                PDF, PNG, JPEG, TXT, or JSON (max 10MB)
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
