# Document Feature - Testing Checklist

## Pre-Test Setup

- [ ] Run `npm run db:generate` to generate migration
- [ ] Run `npm run db:push` to apply migration
- [ ] Start the app with `npm run dev`

## Basic Functionality

- [ ] Navigate to an event and click the "Documents" tab
- [ ] Tab loads without errors
- [ ] "No documents yet" message appears if empty

## File Upload

- [ ] Click "Select Files" button
- [ ] Native file picker dialog appears
- [ ] Can select multiple files at once
- [ ] After selection, files appear in the list
- [ ] File name, size, and upload date are displayed correctly
- [ ] Toast notification shows "Document uploaded successfully"

## File Operations

- [ ] Can click on document name to open it
  - PDF files should open in default PDF viewer
  - Images should open in image viewer
  - Documents open in default app (Word, LibreOffice, etc.)
- [ ] Click folder icon next to document
  - File should appear highlighted in file explorer/finder
  - If open fails, automatically opens folder (fallback)

## Document Management

- [ ] Click dropdown next to file
  - Can select different document types (Deal Memo, Contract, Rider, Invoice, Other)
  - Selection is saved and persists on reload
  - "Document updated" toast appears
- [ ] Click trash icon
  - Confirmation dialog appears
  - Cancel cancels deletion
  - Confirm deletes file and DB record
  - "Document deleted" toast appears
  - File disappears from list

## Data Persistence

- [ ] Reload the page
- [ ] All documents still appear
- [ ] Document types are remembered
- [ ] Files can still be opened/revealed

## Error Handling

- [ ] Try selecting a file with special characters in name
  - File uploads successfully
  - Filename collision: file gets `_1`, `_2` suffix
- [ ] Try opening a file that was deleted externally
  - Error handled gracefully
  - Falls back to reveal in folder
- [ ] Try canceling file dialog
  - No error, dialog just closes

## Multiple Events

- [ ] Upload documents to Event A
- [ ] Create/open Event B
- [ ] Event B should have no documents
- [ ] Go back to Event A
- [ ] Documents should still be there

## Performance

- [ ] Loading tab with 20+ documents should be fast
- [ ] Deleting documents should be quick
- [ ] Uploading large files should not freeze UI

## Cross-Platform (if applicable)

- [ ] **Windows**: Files open in default apps, appear in Explorer correctly
- [ ] **macOS**: Files open in default apps, appear in Finder correctly
- [ ] **Linux**: Files open in default apps, appear in file manager correctly

## Known Limitations

- ⚠️ Drag-and-drop shows info message (would require more complex setup)
- ⚠️ File type restrictions removed (supports any file locally)
- ⚠️ File size limits removed (supports any size locally)

## Edge Cases

- [ ] Upload same filename twice → Gets \_1 suffix automatically
- [ ] Upload empty file → Should handle gracefully
- [ ] Delete while another user is viewing (if multi-user later) → DB handles it
- [ ] Very long filename (100+ chars) → Should truncate/handle gracefully

---

**Overall Status**: Document feature appears to be working correctly ✅ / Needs fixes ❌
