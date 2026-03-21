# Document Management Feature Implementation

## Overview

This document describes the implementation of the Documents tab in the EventHubPage, which allows storing and managing all documents related to an event (deal memos, contracts, riders, invoices, etc.).

## Changes Made

### 1. Database Schema

**File**: `src/main/db/schema.ts`

Added a new `document` table with the following fields:

- `id` (primary key)
- `deal_memo_id` (FK to deal_memo table, cascade delete)
- `file_name` - Original filename
- `file_type` - MIME type
- `file_path` - Relative path from userData directory
- `document_type` - Categorization (deal_memo, contract, rider, invoice, other)
- `file_size` - Size in bytes
- `uploaded_at` - Timestamp when uploaded
- `uploaded_by` - Optional user identifier
- `created_at` - Record creation timestamp
- `updated_at` - Last modification timestamp

Indexes added for performance:

- `deal_memo_id` - for finding documents by event
- `document_type` - for filtering by type
- `uploaded_at` - for sorting by date

### 2. Backend Implementation

#### File Storage Utilities

**File**: `src/main/utils/fileStorage.ts`

Provides safe, cross-platform file operations:

- `getStorageBasePath()` - Returns platform-specific base path using Electron's `app.getPath('userData')`
- `getEventStoragePath(eventId)` - Gets/creates event-specific directory
- `validateFilePath()` - Prevents path traversal attacks
- `copyFileToEventStorage()` - Safely copies files to event directory
- `deleteDocumentFile()` - Safely deletes files
- `generateUniqueFileName()` - Handles filename collisions

**Key Design Decision**: Uses `app.getPath('userData')` instead of hardcoded `%appdata%` paths. This automatically handles:

- Windows: `C:\Users\<username>\AppData\Roaming\<app-name>`
- macOS: `~/Library/Application Support/<app-name>`
- Linux: `~/.config/<app-name>`

#### Data Layer

**Files**:

- `src/main/repositories/DocumentRepository.ts` - Database queries
- `src/main/services/DocumentService.ts` - Business logic

Operations:

- List documents for a deal memo
- Get document by ID
- Create document record
- Update document metadata (type, uploaded_by)
- Delete documents (file + DB record)
- Delete by file path

#### API Layer

**File**: `src/main/api/routers/document.router.ts`

tRPC procedures:

- `getByDealMemoId` - Get all documents for an event
- `getById` - Get specific document details
- `create` - Create document record after file upload
- `update` - Update document metadata
- `delete` - Delete document and physical file
- `getFilePath` - Get full path for file download

**File**: `src/main/api/schemas/document.schema.ts`

Zod schemas for validation:

- `DocumentDto` - DTO for document data
- `CreateDocumentInput` - Validation for creating documents
- `UpdateDocumentInput` - Validation for updating documents
- `DocumentType` - Enum for document categorization

**File**: `src/main/api/mappers/document.mapper.ts`

Entity to DTO mapping for consistent data transfer.

**File**: `src/main/api/router.ts`

Registered `documentRouter` with the main tRPC router.

### 3. Frontend Implementation

**File**: `src/renderer/src/components/event-hub/DocumentsTab.tsx`

A complete React component with:

- **Drag-and-drop zone** - Visual feedback for dragging files
- **File picker** - Button to select files via dialog
- **Document list** - Display all documents with:
  - File name and size
  - Upload date
  - Document type selector (dropdown)
  - Delete button with confirmation
- **Type management** - Change document category via dropdown
- **Load states** - Loading, error, empty states
- **Mutation handling** - Proper success/error feedback via toast notifications

**File**: `src/renderer/src/pages/EventHubPage.tsx`

Replaced `PlaceholderTab` with `DocumentsTab` in the Documents tab section.

## File Upload Implementation (TODO)

The file upload functionality is currently a placeholder. To complete it, implement the following:

### Main Process IPC Handler (in `src/main/index.ts`)

```typescript
import { ipcMain } from 'electron'
import { copyFileToEventStorage, getEventStoragePath } from './utils/fileStorage'

// Handle file upload
ipcMain.handle('document:upload', async (event, { eventId, filePath, fileName }) => {
  try {
    const relativePath = await copyFileToEventStorage(filePath, eventId, fileName)
    return { success: true, relativePath }
  } catch (error) {
    return { success: false, error: error.message }
  }
})
```

The file upload functionality has been fully implemented with:
Replaced `PlaceholderTab` with `DocumentsTab` in the Documents tab section.

## File Upload Implementation ✅ COMPLETED

The file upload functionality has been fully implemented with:

### Main Process IPC Handlers (in `src/main/index.ts`)

- **`document:upload`** - Copies file to event storage with unique filename handling
- **`document:open`** - Opens file with system default application using `shell.openPath()`
- **`document:revealInFolder`** - Shows file in explorer/finder using `shell.showItemInFolder()`
- **`dialog:showOpenDialog`** - Native file picker dialog with multiselection support

```typescript
const api = {
  uploadDocument: (eventId: number, filePath: string, fileName: string) =>
    ipcMain.invoke('document:upload', { eventId, filePath, fileName })
}
```

### Frontend File Handling (in DocumentsTab.tsx)

Once IPC is set up, the `handleFiles` function can:

1. Read file content from dropped/selected files
2. Save temp files to disk
3. Use IPC to copy to event storage
4. Create document record via tRPC
5. Clean up temp files

## Cross-Platform Considerations

### Storage Path

Uses `app.getPath('userData')` which Electron provides, ensuring automatic OS-appropriate paths.

### File I/O

All file operations are in the main process (secure), with validation to prevent path traversal attacks.

### File Types

MIME types are stored for display purposes. You may want to add validation:

```typescript
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]
```

## Database Migration

Run the following after schema changes:

```bash
npm run db:generate  # Generate migration
npm run db:push     # Apply migration
```

## Usage Notes

1. **Viewing Documents**: Open an event and click the "Documents" tab
2. **Adding Documents**: Drop files or click "Select Files" (once upload is implemented)
3. **Categorizing**: Use the type dropdown to categorize documents
4. **Deleting**: Click the trash icon and confirm

## Future Enhancements

1. **File Preview**: Add preview for PDFs, images, etc.
2. **File Download**: Implement download via IPC file open dialog
3. **Upload Progress**: Show progress during large file uploads
4. **Bulk Operations**: Select multiple documents for batch operations
5. **Search**: Filter documents by name or type
6. **Permissions**: Track who uploaded each document
7. **Versioning**: Keep previous versions of documents
8. **Encryption**: Consider encrypting sensitive documents at rest
