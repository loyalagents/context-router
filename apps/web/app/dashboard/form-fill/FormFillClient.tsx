'use client';

import { AiControls, useAiOperation } from '@/components/local/AiControls';
import { operationFailure, reviewLocalFile, validateLocalFile } from '@/lib/local-upload';
import { authenticatedFetch } from '@/lib/authenticated-fetch';

import { useEffect, useRef, useState } from 'react';
import { BACKEND_URL } from '@/lib/runtime-config';

type FormFillStatus =
  | 'success'
  | 'partial'
  | 'no_fillable_fields'
  | 'unsupported_format'
  | 'failed';

interface FilledFieldSummary {
  pdfFieldName: string;
  fieldType: string;
  sourceSlugs: string[];
  confidence: number;
}

interface SkippedFieldSummary {
  pdfFieldName: string;
  fieldType: string;
  reason: string;
  confidence?: number;
  sourceSlugs?: string[];
}

interface FormFillSummary {
  totalFields: number;
  filledCount: number;
  skippedCount: number;
  filledFields: FilledFieldSummary[];
  skippedFields: SkippedFieldSummary[];
  warnings: string[];
}

interface FormFillResponse {
  failureCategory?: string;
  fillId: string;
  status: FormFillStatus;
  originalFilename: string;
  outputFilename: string;
  outputMimeType: 'application/pdf';
  filledPdfBase64: string | null;
  summary: FormFillSummary;
}

interface FormFillResult extends Omit<FormFillResponse, 'filledPdfBase64'> {}

interface FormFillClientProps {
  accessToken: string;
}

function statusLabel(status: FormFillStatus): string {
  switch (status) {
    case 'success':
      return 'Filled';
    case 'partial':
      return 'Partially filled';
    case 'no_fillable_fields':
      return 'No fillable fields';
    case 'unsupported_format':
      return 'Unsupported format';
    case 'failed':
      return 'Failed';
  }
}

function fileSizeLabel(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function blobUrlFromBase64(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export default function FormFillClient({ accessToken }: FormFillClientProps) {
  const operation = useAiOperation('formFill');
  const local = operation.session;
  const [consent, setConsent] = useState(false);
  const [overwrite, setOverwrite] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FormFillResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const replaceDownloadUrl = (nextUrl: string | null) => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    objectUrlRef.current = nextUrl;
    setDownloadUrl(nextUrl);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    selectFile(file);
    event.target.value = '';
  };

  const selectFile = (file: File | null) => {
    if (operation.pending) return;
    const invalid = file && local ? validateLocalFile(file, local.capabilities.operations.formFill) : null;
    setSelectedFile(invalid ? null : file);
    setOverwrite('');
    setResult(null);
    replaceDownloadUrl(null);
    setError(invalid);
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);

    if (isUploading) {
      return;
    }

    const file = event.dataTransfer.files?.[0] ?? null;
    selectFile(file);
  };

  const upload = async () => {
    if (operation.pending || !operation.available || (local && !consent)) return;
    if (!selectedFile) {
      setError('Select a fillable PDF first.');
      return;
    }

    if (selectedFile.type !== 'application/pdf') {
      setError('Only PDF uploads are supported for this form-fill prototype.');
      return;
    }

    const fields = [...new Set(overwrite.split('\n').map((value) => value.trim()).filter(Boolean))];
    if (fields.length > 32 || fields.some((name) => name.length > 256)) { setError('Enter at most 32 field names, each at most 256 characters.'); return; }
    const request = operation.begin();
    setIsUploading(true);
    setError(null);
    setResult(null);
    replaceDownloadUrl(null);

    try {
      if (local && !await reviewLocalFile(selectedFile, local.capabilities.operations.formFill, request.signal)) throw new Error('Upload cancelled during secret review.');
      request.signal.throwIfAborted();
      const backendUrl = BACKEND_URL;
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (local) formData.append('fieldPolicies', JSON.stringify({ schemaVersion: 2, fields: fields.map((fieldName) => ({ fieldName, overwrite: true })) }));

      const response = await authenticatedFetch(`${backendUrl}/api/form-fill/pdf`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...request.headers,
        },
        body: formData,
        signal: request.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Upload failed: ${response.statusText}`);
      }

      const data: FormFillResponse = await response.json();
      request.signal.throwIfAborted();
      if (!operation.isCurrent(request.controller)) return;
      const { filledPdfBase64, ...summaryResult } = data;

      if (filledPdfBase64) {
        replaceDownloadUrl(
          blobUrlFromBase64(filledPdfBase64, data.outputMimeType),
        );
      }

      setResult(summaryResult);
    } catch (uploadError) {
      if (operation.isCurrent(request.controller)) setError(operationFailure(uploadError, request.signal));
    } finally {
      if (operation.isCurrent(request.controller)) { setSelectedFile(null); setIsUploading(false); setOverwrite(''); }
      operation.finish(request.controller);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 border rounded-lg bg-white shadow-sm">
        <div className="space-y-4">
          {local && <>
            <p className="text-sm text-gray-600">Fillable PDFs only, up to {Math.floor(local.capabilities.operations.formFill.maxFileSizeBytes / 1024 / 1024)} MB. Existing nonempty fields are preserved. Review the output before use.</p>
            <p className="text-sm text-gray-600">Raw input stays in memory for this operation and is released afterward. The filled PDF stays here until replaced, locked or closed.</p>
            <label className="block text-sm"><input type="checkbox" checked={consent} disabled={isUploading} onChange={(e) => setConsent(e.target.checked)} /> I reviewed this PDF and consent to sending its field metadata and my stored preferences to the local model.</label>
          </>}
          <div>
            <input
              id="form-file"
              type="file"
              accept="application/pdf,.pdf"
              disabled={isUploading || !operation.available || (!!local && !consent)}
              onChange={handleFileChange}
              className="sr-only"
            />
            <label
              htmlFor="form-file"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`block cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              } ${isUploading ? 'pointer-events-none opacity-50' : ''}`}
            >
              <span className="block text-sm font-medium text-gray-900">
                Drop a fillable PDF here
              </span>
              <span className="mt-1 block text-sm text-gray-500">
                or click to choose one from your computer
              </span>
            </label>
            {selectedFile && (
              <p className="mt-2 text-sm text-gray-500">
                {selectedFile.name} ({fileSizeLabel(selectedFile.size)})
              </p>
            )}
          </div>

          {local && <label className="block text-sm">Fields to overwrite (exact PDF field names, one per line)
            <textarea aria-label="Fields to overwrite" value={overwrite} disabled={isUploading} onChange={(e) => setOverwrite(e.target.value)} rows={2} maxLength={8224} className="block w-full border rounded p-2" />
            <span>Only the fields you name may replace existing values. Leave empty to preserve all existing values. Skipped field names appear in the results.</span>
          </label>}
          <AiControls operation={operation} onCancel={() => { setSelectedFile(null); setOverwrite(''); setIsUploading(false); setError('Operation cancelled. Input released; check model status before continuing.'); }} />
          <button
            type="button"
            onClick={upload}
            disabled={isUploading || !selectedFile || !operation.available || (!!local && !consent)}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? 'Filling PDF...' : 'Fill PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="p-6 border rounded-lg bg-white shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {statusLabel(result.status)}
              </h2>
              <p className="text-sm text-gray-500">
                {result.summary.filledCount} filled,{' '}
                {result.summary.skippedCount} skipped from{' '}
                {result.summary.totalFields} fields
              </p>
            </div>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={result.outputFilename}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Download Filled PDF
              </a>
            )}
          </div>

          {result.failureCategory && <p role="status">AI result: {result.failureCategory}. Check model status before continuing.</p>}
          {result.summary.warnings.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              {result.summary.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          {result.summary.filledFields.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Filled fields
              </h3>
              <div className="divide-y border rounded">
                {result.summary.filledFields.map((field) => (
                  <div
                    key={field.pdfFieldName}
                    className="p-3 text-sm grid gap-1 sm:grid-cols-[1fr_2fr]"
                  >
                    <span className="font-medium text-gray-900">
                      {field.pdfFieldName}
                    </span>
                    <span className="text-gray-600">
                      {field.sourceSlugs.length > 0
                        ? `From ${field.sourceSlugs.join(', ')}`
                        : 'Filled from memory'}{' '}
                      ({Math.round(field.confidence * 100)}% confidence)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.summary.skippedFields.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                Skipped fields
              </h3>
              <div className="divide-y border rounded">
                {result.summary.skippedFields.map((field) => (
                  <div
                    key={field.pdfFieldName}
                    className="p-3 text-sm grid gap-1 sm:grid-cols-[1fr_2fr]"
                  >
                    <span className="font-medium text-gray-900">
                      {field.pdfFieldName}
                    </span>
                    <span className="text-gray-600">{field.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-sm text-gray-500">
            {local ? 'Skipped fields retain their original values. No skipped or conflicting action was applied.' : 'Skipped fields were left blank instead of being guessed.'}
          </p>
        </div>
      )}
    </div>
  );
}
