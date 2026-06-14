'use client';

import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, File, X, AlertCircle } from 'lucide-react';
import { cn, formatFileSize } from '@/lib/utils';

interface FileDropzoneProps {
  onFile: (file: File) => void;
  accept?: Record<string, string[]>;
  label?: string;
  maxSize?: number;
  currentFile?: File | null;
  onRemove?: () => void;
}

export function FileDropzone({
  onFile,
  accept = {
    'application/pdf': ['.pdf'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/msword': ['.doc'],
  },
  label = 'Drop your CV here',
  maxSize = 10 * 1024 * 1024, // 10 MB
  currentFile,
  onRemove,
}: FileDropzoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFile(acceptedFiles[0]);
      }
    },
    [onFile]
  );

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept,
    maxSize,
    multiple: false,
  });

  const rejectionError = fileRejections[0]?.errors[0];

  if (currentFile) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
            <File size={20} className="text-green-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800 truncate max-w-[200px]">
              {currentFile.name}
            </p>
            <p className="text-xs text-slate-500">{formatFileSize(currentFile.size)}</p>
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
            aria-label="Remove file"
          >
            <X size={15} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors',
          isDragActive
            ? 'border-primary-400 bg-primary-50'
            : 'border-slate-300 bg-white hover:border-primary-300 hover:bg-slate-50',
          rejectionError && 'border-red-300 bg-red-50'
        )}
      >
        <input {...getInputProps()} />
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-full',
            isDragActive ? 'bg-primary-100' : 'bg-slate-100'
          )}
        >
          <UploadCloud
            size={24}
            className={isDragActive ? 'text-primary-600' : 'text-slate-400'}
          />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-700">
            {isDragActive ? 'Release to upload' : label}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            or <span className="text-primary-600 font-medium">browse files</span>
          </p>
          <p className="mt-2 text-xs text-slate-400">
            PDF, DOCX, DOC up to {formatFileSize(maxSize)}
          </p>
        </div>
      </div>

      {rejectionError && (
        <div className="flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle size={13} />
          <span>
            {rejectionError.code === 'file-too-large'
              ? `File exceeds ${formatFileSize(maxSize)}`
              : rejectionError.code === 'file-invalid-type'
              ? 'Invalid file type. Please upload PDF or DOCX.'
              : rejectionError.message}
          </span>
        </div>
      )}
    </div>
  );
}
