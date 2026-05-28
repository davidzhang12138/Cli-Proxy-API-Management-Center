# Batch Disable Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add batch disable functionality to the quota management page — both one-click disable of refresh-failed keys and manual selection mode with floating action bar.

**Architecture:** Two entry points in `QuotaSection`: (1) a "Disable All Failed" button in the existing `refreshFailurePanel`, and (2) a selection mode toggle that shows checkboxes on each `QuotaCard` plus a sticky bottom action bar. Both share a confirmation modal and the same batch-disable logic using parallel `authFilesApi.setStatus()` calls. A new `onFilesChanged` prop pipes the reload callback from `QuotaPage` down to `QuotaSection`.

**Tech Stack:** React, TypeScript, SCSS modules, react-i18next, Zustand (existing stores)

---

### Task 1: Add i18n Keys for Batch Disable

**Files:**
- Modify: `src/i18n/locales/en.json:1409` (insert before the closing `}` of `quota_management`)
- Modify: `src/i18n/locales/zh-CN.json:1409` (same location)
- Modify: `src/i18n/locales/zh-TW.json` (same section)
- Modify: `src/i18n/locales/ru.json` (same section)

- [ ] **Step 1: Add English i18n keys**

In `src/i18n/locales/en.json`, inside the `"quota_management"` object, before the closing `}` (after line 1409 `"refresh_all_credentials": "Refresh all credentials"`), add:

```json
    "select_mode_enter": "Select",
    "select_mode_exit": "Cancel",
    "selected_count": "{{count}} selected",
    "select_all_page": "Select all on page",
    "deselect_all": "Deselect all",
    "batch_disable": "Disable selected",
    "batch_disable_failed_keys": "Disable all failed",
    "batch_disable_confirm_title": "Confirm Batch Disable",
    "batch_disable_confirm_body": "The following {{count}} credentials will be disabled:",
    "batch_disable_confirm_button": "Confirm Disable",
    "batch_disable_success": "Successfully disabled {{count}} credentials",
    "batch_disable_partial": "Disabled {{success}} credentials, {{failed}} failed",
    "batch_disable_error": "Failed to disable credentials"
```

- [ ] **Step 2: Add Chinese (zh-CN) i18n keys**

In `src/i18n/locales/zh-CN.json`, inside the `"quota_management"` object, in the same position, add:

```json
    "select_mode_enter": "选择",
    "select_mode_exit": "取消",
    "selected_count": "已选 {{count}} 项",
    "select_all_page": "全选当前页",
    "deselect_all": "取消全选",
    "batch_disable": "禁用选中项",
    "batch_disable_failed_keys": "禁用全部失败",
    "batch_disable_confirm_title": "确认批量禁用",
    "batch_disable_confirm_body": "以下 {{count}} 个凭证将被禁用：",
    "batch_disable_confirm_button": "确认禁用",
    "batch_disable_success": "成功禁用 {{count}} 个凭证",
    "batch_disable_partial": "已禁用 {{success}} 个，失败 {{failed}} 个",
    "batch_disable_error": "禁用凭证失败"
```

- [ ] **Step 3: Add zh-TW and ru keys**

Apply the same pattern to `zh-TW.json` (use Traditional Chinese equivalents) and `ru.json` (use English for now as placeholder — consistent with other keys in the file that may not yet be translated).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/zh-CN.json src/i18n/locales/zh-TW.json src/i18n/locales/ru.json
git commit -m "feat(i18n): add batch disable keys for quota management page"
```

---

### Task 2: Add SCSS Styles for Batch Disable UI

**Files:**
- Modify: `src/pages/QuotaPage.module.scss` (append new classes)

- [ ] **Step 1: Add styles for the "Disable All Failed" button in the refresh failure header**

Append after the `.refreshFailureReason` block (around line 632), before the `:global([data-theme='dark'])` section:

```scss
.refreshFailureActions {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  flex: 0 0 auto;
}

.disableFailedButton:global(.btn.btn-sm) {
  padding-inline: 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger-color) 12%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--danger-color) 26%, var(--border-color));
  color: var(--danger-color);
  white-space: nowrap;

  > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger-color) 18%, var(--bg-secondary));
    border-color: color-mix(in srgb, var(--danger-color) 38%, var(--border-color));
  }
}
```

- [ ] **Step 2: Add styles for the selection mode toggle button**

Append after the new styles from Step 1:

```scss
.selectModeButton:global(.btn.btn-sm) {
  padding-inline: 14px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-hover) 48%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--border-color) 92%, transparent);
  color: var(--text-primary);

  > span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--bg-hover) 72%, var(--bg-secondary));
    border-color: color-mix(in srgb, var(--primary-color) 22%, var(--border-color));
  }
}

.selectModeButtonActive:global(.btn.btn-sm) {
  background: color-mix(in srgb, var(--primary-color) 12%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--primary-color) 26%, var(--border-color));
  color: var(--primary-color);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--primary-color) 18%, var(--bg-secondary));
    border-color: color-mix(in srgb, var(--primary-color) 38%, var(--border-color));
  }
}
```

- [ ] **Step 3: Add styles for the card selection checkbox**

Append:

```scss
.cardSelectionCheckbox {
  flex: 0 0 auto;
  margin-right: 2px;
}

.fileCardSelected {
  border-color: color-mix(in srgb, var(--primary-color) 40%, var(--border-color));
  background: color-mix(in srgb, var(--primary-color) 4%, var(--bg-primary));
}
```

- [ ] **Step 4: Add styles for the floating action bar**

Append:

```scss
.batchActionBar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-sm;
  padding: 10px 14px;
  margin-top: $spacing-md;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--primary-color) 24%, var(--border-color));
  background: color-mix(in srgb, var(--bg-secondary) 96%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);

  @include mobile {
    flex-direction: column;
    align-items: stretch;
  }
}

.batchActionBarInfo {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.batchActionBarActions {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  flex-wrap: wrap;

  @include mobile {
    justify-content: stretch;
  }
}

.batchDisableButton:global(.btn.btn-sm) {
  padding-inline: 14px;
  border-radius: 999px;
  background: var(--danger-color);
  border-color: var(--danger-color);
  color: #fff;

  > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger-color) 88%, #000);
    border-color: color-mix(in srgb, var(--danger-color) 88%, #000);
  }
}
```

- [ ] **Step 5: Add styles for the confirmation modal body**

Append:

```scss
.batchDisableModalBody {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.batchDisableModalHint {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.batchDisableModalList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-secondary);
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
}

.batchDisableModalItem {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  line-height: 1.5;
  padding: 2px 0;
}

.batchDisableModalFooter {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: $spacing-sm;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/QuotaPage.module.scss
git commit -m "style(quota): add SCSS styles for batch disable UI"
```

---

### Task 3: Add Selection Mode Props to QuotaCard

**Files:**
- Modify: `src/components/quota/QuotaCard.tsx`

- [ ] **Step 1: Add import for SelectionCheckbox**

At the top of `QuotaCard.tsx`, add this import after the existing `import { IconRefreshCw } from` line:

```typescript
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
```

- [ ] **Step 2: Add new props to QuotaCardProps interface**

In the `QuotaCardProps` interface (around line 93), add three new optional props after `onRefresh?`:

```typescript
  selectionMode?: boolean;
  selected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
```

- [ ] **Step 3: Destructure new props in the component function**

In the `QuotaCard` function destructuring (around line 114), add the new props after `onRefresh`:

```typescript
  selectionMode = false,
  selected = false,
  onSelectionChange,
```

- [ ] **Step 4: Modify click handlers for selection mode**

Replace the existing `openModelsModal` function and `handleCardKeyDown` function (lines ~177-185) with:

```typescript
  const openModelsModal = () => {
    if (selectionMode) {
      onSelectionChange?.(!selected);
      return;
    }
    setModelsModalOpen(true);
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (selectionMode) {
      onSelectionChange?.(!selected);
      return;
    }
    setModelsModalOpen(true);
  };
```

- [ ] **Step 5: Add checkbox to card header and selection styling to card root**

Replace the card root `<div>` opening tag (around line 197-204):

```tsx
    <div
      className={`${styles.fileCard} ${cardClassName} ${styles.fileCardClickable}${selected ? ` ${styles.fileCardSelected}` : ''}`}
      onClick={openModelsModal}
      onKeyDown={handleCardKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('quota_management.top_models_modal_title', { name: item.name })}
    >
```

And in the `cardHeaderMain` div (around line 206-218), add the checkbox before the type badge:

Replace:
```tsx
        <div className={styles.cardHeaderMain}>
          <span
```

With:
```tsx
        <div className={styles.cardHeaderMain}>
          {selectionMode && (
            <div
              className={styles.cardSelectionCheckbox}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <SelectionCheckbox
                checked={selected}
                onChange={(value) => onSelectionChange?.(value)}
                ariaLabel={t('quota_management.top_models_modal_title', { name: item.name })}
              />
            </div>
          )}
          <span
```

- [ ] **Step 6: Commit**

```bash
git add src/components/quota/QuotaCard.tsx
git commit -m "feat(quota-card): add selection mode props and checkbox rendering"
```

---

### Task 4: Add Batch Disable Logic and UI to QuotaSection

**Files:**
- Modify: `src/components/quota/QuotaSection.tsx`

This is the largest task. It adds: (1) selection mode state, (2) one-click disable failed keys button, (3) confirmation modal, (4) batch disable execution logic, (5) floating action bar.

- [ ] **Step 1: Add new imports**

At the top of `QuotaSection.tsx`, add these imports:

After `import { Button } from '@/components/ui/Button';`:
```typescript
import { Modal } from '@/components/ui/Modal';
```

After `import { EmptyState } from '@/components/ui/EmptyState';`:
```typescript
import { authFilesApi } from '@/services/api';
```

In the `import { IconRefreshCw, IconX } from '@/components/ui/icons';` line, no change needed — both icons are already imported.

- [ ] **Step 2: Add `onFilesChanged` prop to `QuotaSectionProps`**

In the `QuotaSectionProps` interface (around line 759), add after `fileModelsByName`:

```typescript
  onFilesChanged?: () => void;
```

And destructure it in the component function signature (around line 773), add after `fileModelsByName`:

```typescript
  onFilesChanged,
```

- [ ] **Step 3: Add selection mode and batch disable state variables**

After the existing `const [refreshResult, setRefreshResult]` line (around line 801), add:

```typescript
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchDisabling, setBatchDisabling] = useState(false);
  const [batchDisableConfirmNames, setBatchDisableConfirmNames] = useState<string[] | null>(null);
```

- [ ] **Step 4: Add helper functions for selection management**

After the state variables from Step 3, add:

```typescript
  const toggleSelection = useCallback((name: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectAllPage = useCallback(() => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      pageItems.forEach((file) => next.add(file.name));
      return next;
    });
  }, [pageItems]);

  const deselectAll = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, []);
```

- [ ] **Step 5: Add the batch disable execution function**

After the selection helpers from Step 4, add:

```typescript
  const executeBatchDisable = useCallback(
    async (names: string[]) => {
      if (names.length === 0) return;
      setBatchDisabling(true);
      setBatchDisableConfirmNames(null);

      try {
        const results = await Promise.allSettled(
          names.map((name) => authFilesApi.setStatus(name, true))
        );

        const successCount = results.filter((r) => r.status === 'fulfilled').length;
        const failCount = results.length - successCount;

        if (failCount === 0) {
          showNotification(
            t('quota_management.batch_disable_success', { count: successCount }),
            'success'
          );
        } else if (successCount > 0) {
          showNotification(
            t('quota_management.batch_disable_partial', {
              success: successCount,
              failed: failCount
            }),
            'warning'
          );
        } else {
          showNotification(t('quota_management.batch_disable_error'), 'error');
        }

        setRefreshResult(null);
        exitSelectionMode();
        onFilesChanged?.();
      } finally {
        setBatchDisabling(false);
      }
    },
    [exitSelectionMode, onFilesChanged, showNotification, t]
  );
```

- [ ] **Step 6: Add "Disable All Failed" button to the refresh failure panel**

Find the existing `refreshFailureHeader` JSX (around line 1432-1454). The current structure is:

```tsx
<div className={styles.refreshFailureHeader}>
  <div>
    <strong>...</strong>
    <span>...</span>
  </div>
  <button ... className={styles.refreshFailureClose} ...>
    <IconX size={16} />
  </button>
</div>
```

Replace the close button section with an actions wrapper containing both the disable button and the close button:

```tsx
<div className={styles.refreshFailureHeader}>
  <div>
    <strong>
      {t('quota_management.refresh_failed_details_title', {
        count: refreshResult.errorCount
      })}
    </strong>
    <span>
      {t('quota_management.refresh_failed_details_summary', {
        success: refreshResult.successCount,
        total: refreshResult.total
      })}
    </span>
  </div>
  <div className={styles.refreshFailureActions}>
    <Button
      variant="danger"
      size="sm"
      className={styles.disableFailedButton}
      onClick={() =>
        setBatchDisableConfirmNames(
          refreshResult.errors.map((item) => item.name)
        )
      }
      disabled={batchDisabling}
      loading={batchDisabling}
    >
      {t('quota_management.batch_disable_failed_keys')}
    </Button>
    <button
      type="button"
      className={styles.refreshFailureClose}
      onClick={() => setRefreshResult(null)}
      aria-label={t('common.close')}
    >
      <IconX size={16} />
    </button>
  </div>
</div>
```

- [ ] **Step 7: Add "Select" toggle button to headerActions**

In the `extra` prop of the `<Card>` component (around line 1368), before the existing `viewModeToggle` div, add the select mode button:

```tsx
<div className={styles.headerActions}>
  <Button
    variant="secondary"
    size="sm"
    className={`${styles.selectModeButton} ${selectionMode ? styles.selectModeButtonActive : ''}`}
    onClick={() => {
      if (selectionMode) {
        exitSelectionMode();
      } else {
        setSelectionMode(true);
      }
    }}
    disabled={disabled || visibleFiles.length === 0}
  >
    {selectionMode
      ? t('quota_management.select_mode_exit')
      : t('quota_management.select_mode_enter')}
  </Button>
  <div className={styles.viewModeToggle}>
    {/* ... existing view mode buttons ... */}
  </div>
  {/* ... existing refresh progress badge and refresh actions ... */}
</div>
```

- [ ] **Step 8: Pass selection props to QuotaCard**

In the `pageItems.map` where `<QuotaCard>` is rendered (around line 1522-1544), add the three new props:

```tsx
<QuotaCard
  key={item.name}
  item={item}
  quota={quotaState}
  /* ... all existing props ... */
  selectionMode={selectionMode}
  selected={selectedKeys.has(item.name)}
  onSelectionChange={() => toggleSelection(item.name)}
/>
```

- [ ] **Step 9: Add the floating action bar**

After the grid div closing tag (`</div>`) and before the pagination section (the `{effectiveViewMode === 'paged' && (` block, around line 1547), add:

```tsx
{selectionMode && selectedKeys.size > 0 && (
  <div className={styles.batchActionBar}>
    <div className={styles.batchActionBarInfo}>
      {t('quota_management.selected_count', { count: selectedKeys.size })}
    </div>
    <div className={styles.batchActionBarActions}>
      <Button
        variant="secondary"
        size="sm"
        className={styles.selectModeButton}
        onClick={selectAllPage}
      >
        {t('quota_management.select_all_page')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className={styles.selectModeButton}
        onClick={deselectAll}
      >
        {t('quota_management.deselect_all')}
      </Button>
      <Button
        variant="danger"
        size="sm"
        className={styles.batchDisableButton}
        onClick={() =>
          setBatchDisableConfirmNames(Array.from(selectedKeys))
        }
        disabled={batchDisabling}
        loading={batchDisabling}
      >
        {t('quota_management.batch_disable')}
      </Button>
    </div>
  </div>
)}
```

- [ ] **Step 10: Add the confirmation modal**

At the very end of the `<Card>` component's children, just before the closing `</Card>` tag (after the `showTooManyWarning` modal section), add:

```tsx
<Modal
  open={batchDisableConfirmNames !== null}
  onClose={() => setBatchDisableConfirmNames(null)}
  title={t('quota_management.batch_disable_confirm_title')}
  closeDisabled={batchDisabling}
  footer={
    <div className={styles.batchDisableModalFooter}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setBatchDisableConfirmNames(null)}
        disabled={batchDisabling}
      >
        {t('common.cancel')}
      </Button>
      <Button
        variant="danger"
        size="sm"
        className={styles.batchDisableButton}
        onClick={() => {
          if (batchDisableConfirmNames) {
            void executeBatchDisable(batchDisableConfirmNames);
          }
        }}
        disabled={batchDisabling}
        loading={batchDisabling}
      >
        {t('quota_management.batch_disable_confirm_button')}
      </Button>
    </div>
  }
>
  <div className={styles.batchDisableModalBody}>
    <div className={styles.batchDisableModalHint}>
      {t('quota_management.batch_disable_confirm_body', {
        count: batchDisableConfirmNames?.length ?? 0
      })}
    </div>
    <div className={styles.batchDisableModalList}>
      {batchDisableConfirmNames?.map((name) => (
        <div key={name} className={styles.batchDisableModalItem}>
          {name}
        </div>
      ))}
    </div>
  </div>
</Modal>
```

- [ ] **Step 11: Add `useState` to imports if needed**

Verify that `useState` and `useCallback` are both already imported from React at the top — they are (line 5). No changes needed.

- [ ] **Step 12: Commit**

```bash
git add src/components/quota/QuotaSection.tsx
git commit -m "feat(quota-section): add selection mode, batch disable, and confirmation modal"
```

---

### Task 5: Wire up `onFilesChanged` in QuotaPage

**Files:**
- Modify: `src/pages/QuotaPage.tsx`

- [ ] **Step 1: Add `onFilesChanged` prop to `commonSectionProps`**

In `QuotaPage.tsx`, find the `commonSectionProps` object (around line 357). Add `onFilesChanged` to it:

```typescript
  const commonSectionProps = {
    files,
    loading,
    disabled: disableControls,
    usageDetails,
    usageStatsReady,
    availabilityFilter,
    selectedModel,
    sortMode,
    searchQuery: deferredSearchQuery,
    fileModelsByName,
    onFilesChanged: loadFiles
  };
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/QuotaPage.tsx
git commit -m "feat(quota-page): pass onFilesChanged callback to QuotaSection"
```

---

### Task 6: Manual Testing and Polish

**Files:**
- No new files, testing existing changes

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or the project's dev script)

- [ ] **Step 2: Test one-click disable of failed keys**

1. Navigate to the Quota Management page
2. Trigger a refresh on a page that contains keys expected to fail (or simulate by temporarily breaking a credential)
3. Verify the "Disable All Failed" button appears in the refresh failure panel
4. Click it and verify the confirmation modal appears with the list of failed key names
5. Click "Confirm Disable" and verify:
   - The keys are disabled (notification shows success)
   - The file list reloads
   - The failure panel closes

- [ ] **Step 3: Test selection mode**

1. Click the "Select" button in the section header
2. Verify checkboxes appear on all cards
3. Click a card — verify it toggles selection (not opening the modal)
4. Click "Select All Page" — verify all cards on the current page are selected
5. Navigate to another page — verify the previous selections are preserved
6. Click "Deselect All" — verify all selections are cleared
7. Select some keys, click "Disable selected" — verify the confirmation modal, disable execution, and list reload
8. Verify clicking "Cancel" (or the X) exits selection mode

- [ ] **Step 4: Test edge cases**

1. Enter selection mode with no items visible (button should be disabled)
2. Verify the floating action bar only shows when items are selected
3. Verify the confirmation modal's "Confirm Disable" button shows loading state during execution
4. Verify partial failures show a warning notification with counts

- [ ] **Step 5: Final commit (if any polish changes were made)**

```bash
git add -A
git commit -m "fix(quota): polish batch disable UI after manual testing"
```
