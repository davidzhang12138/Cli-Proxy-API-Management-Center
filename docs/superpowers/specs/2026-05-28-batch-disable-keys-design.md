# Batch Disable Keys on Quota Management Page

## Overview

Add batch disable functionality to the quota management page (QuotaPage). Two entry points:

1. **One-click disable on refresh failure** — a button in the refresh failure panel to disable all failed keys at once.
2. **Manual selection mode** — enter a selection mode, pick individual keys via checkboxes, then batch disable the selection.

## Feature 1: One-Click Disable Failed Keys

### Location

Inside `QuotaSection.tsx`, within the existing `refreshFailurePanel` (rendered when `refreshResult.errorCount > 0`).

### Behavior

- Add a "Disable All Failed" button in the `refreshFailureHeader`, next to the close button.
- Clicking the button opens a confirmation modal (using the existing `Modal` component) listing the names and count of keys to be disabled.
- On confirm, execute `Promise.allSettled` over `authFilesApi.setStatus(name, true)` for each failed key name from `refreshResult.errors`.
- Display a notification with success/failure counts.
- On completion, reload the file list (call `loadFiles` from QuotaPage via a new `onFilesChanged` callback prop) and close the failure panel by setting `refreshResult` to null.

### UI Elements

```
┌─ refreshFailurePanel ──────────────────────────────────────────────┐
│ ┌─ refreshFailureHeader ────────────────────────────────────────┐  │
│ │  <strong>N items failed</strong>  (X/Y success)                │  │
│ │                              [Disable All Failed] [X close]   │  │
│ └───────────────────────────────────────────────────────────────┘  │
│  key-1.json   — 403 Forbidden                                     │
│  key-2.json   — timeout                                           │
└────────────────────────────────────────────────────────────────────┘
```

## Feature 2: Selection Mode + Batch Disable

### State Management (QuotaSection)

New state variables:

- `selectionMode: boolean` — whether the section is in selection mode.
- `selectedKeys: Set<string>` — file names currently selected.
- `batchDisabling: boolean` — whether a batch disable operation is in progress.

### Entering / Exiting Selection Mode

- Add a "Select" toggle button in the `headerActions` area (alongside the view mode toggle).
- When active, the button label changes to "Cancel" (and uses an active style).
- Exiting selection mode clears `selectedKeys`.
- Selection mode is also exited after a successful batch disable.

### QuotaCard Changes

New optional props on `QuotaCard`:

| Prop | Type | Description |
|------|------|-------------|
| `selectionMode` | `boolean` | Whether the parent section is in selection mode |
| `selected` | `boolean` | Whether this card is currently selected |
| `onSelectionChange` | `(selected: boolean) => void` | Toggle callback |

When `selectionMode` is true:

- Render a `SelectionCheckbox` in the `cardHeader`, before the type badge.
- The checkbox click handler calls `stopPropagation()` to avoid opening the detail modal.
- The entire card click (in selection mode) toggles selection instead of opening the modal.

### Floating Action Bar

When `selectionMode` is true and `selectedKeys.size > 0`, render a sticky bottom bar inside the Card:

```
┌──────────────────────────────────────────────────────────────────┐
│  Selected: 3    [Select All Page] [Deselect All]  [Disable ▶]   │
└──────────────────────────────────────────────────────────────────┘
```

- "Select All Page" selects all items on the current page.
- "Deselect All" clears the entire `selectedKeys` set.
- "Disable" button triggers the confirmation modal.
- Uses `position: sticky; bottom: 0;` to stay visible while scrolling.

### Batch Disable Flow

1. User clicks "Disable Selected".
2. Confirmation modal shows: "About to disable N credentials: name1, name2, ... Continue?"
3. On confirm:
   - Set `batchDisabling` to true.
   - Execute `Promise.allSettled` calling `authFilesApi.setStatus(name, true)` for each selected key.
   - Show notification with results (success/failure counts).
   - Reload file list via `onFilesChanged`.
   - Exit selection mode and clear selections.
4. On cancel: close modal, no action.

## Confirmation Modal

Shared between both features. Content structure:

- Title: "Confirm Batch Disable"
- Body: "The following N credentials will be disabled:" followed by a scrollable list of names (max-height ~200px).
- Footer: "Cancel" and "Confirm Disable" buttons.
- "Confirm Disable" button uses a danger/destructive style.

## Props Changes

### QuotaSection

New prop:

| Prop | Type | Description |
|------|------|-------------|
| `onFilesChanged` | `() => void` | Callback to reload the file list after batch disable |

### QuotaPage

- Pass `loadFiles` (or a wrapper) as `onFilesChanged` to each QuotaSection.

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/quota/QuotaSection.tsx` | Selection mode state, one-click disable for failures, floating action bar, confirmation modal, batch disable logic |
| `src/components/quota/QuotaCard.tsx` | New props (`selectionMode`, `selected`, `onSelectionChange`), conditional checkbox in header, click behavior change in selection mode |
| `src/pages/QuotaPage.tsx` | Pass `onFilesChanged` callback to QuotaSection |
| `src/pages/QuotaPage.module.scss` | Styles for floating action bar, checkbox-in-card, disable button in failure panel |
| i18n translation files | New keys for batch disable UI text |

## Files NOT Modified

- `src/services/api/authFiles.ts` — no new API method; batch is implemented via parallel single calls.
- No new component files — all UI is added to existing components.

## Error Handling

- Individual failures during batch disable are collected and reported in the notification.
- If all calls fail, show an error notification.
- If some succeed and some fail, show a warning notification with details.
- The file list is always reloaded regardless of partial failures.

## i18n Keys (to be added)

```
quota_management.select_mode_enter
quota_management.select_mode_exit
quota_management.selected_count
quota_management.select_all_page
quota_management.deselect_all
quota_management.batch_disable
quota_management.batch_disable_failed_keys
quota_management.batch_disable_confirm_title
quota_management.batch_disable_confirm_body
quota_management.batch_disable_confirm_button
quota_management.batch_disable_success
quota_management.batch_disable_partial
quota_management.batch_disable_error
```
