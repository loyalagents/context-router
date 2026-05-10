'use client';

import { useEffect, useRef, useState } from 'react';

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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
    setSelectedFile(file);
    setResult(null);
    replaceDownloadUrl(null);
    setError(null);
  };

  const upload = async () => {
    if (!selectedFile) {
      setError('Select a fillable PDF first.');
      return;
    }

    if (selectedFile.type !== 'application/pdf') {
      setError('Only PDF uploads are supported for this form-fill prototype.');
      return;
    }

    setIsUploading(true);
    setError(null);
    setResult(null);
    replaceDownloadUrl(null);

    try {
      const backendUrl =
        process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000';
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${backendUrl}/api/form-fill/pdf`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Upload failed: ${response.statusText}`);
      }

      const data: FormFillResponse = await response.json();
      const { filledPdfBase64, ...summaryResult } = data;

      if (filledPdfBase64) {
        replaceDownloadUrl(
          blobUrlFromBase64(filledPdfBase64, data.outputMimeType),
        );
      }

      setResult(summaryResult);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Form fill failed.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="p-6 border rounded-lg bg-white shadow-sm">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="form-file"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Fillable PDF
            </label>
            <input
              id="form-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-700 file:mr-4 file:rounded file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
            />
            {selectedFile && (
              <p className="mt-2 text-sm text-gray-500">
                {selectedFile.name} ({fileSizeLabel(selectedFile.size)})
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={upload}
            disabled={isUploading || !selectedFile}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? 'Filling PDF...' : 'Fill PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 border border-red-200 rounded-lg bg-red-50 text-red-700">
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

          {result.summary.warnings.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              {result.summary.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
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
            Skipped fields were left blank instead of being guessed.
          </p>
        </div>
      )}
    </div>
  );
}
