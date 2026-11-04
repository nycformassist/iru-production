/**
 * src/RepeatingGroup.tsx — Repeating group questionnaire UI (Phase 3, 4c).
 *
 * Implements the approved applicant workflow:
 * - Collect one entry at a time
 * - "Add Another" action
 * - Summary of all entries with edit/delete
 * - Review before PDF generation
 *
 * Used for: entry history, last address, children, and other repeating groups.
 */

import React, { useState } from 'react';

export interface RepeatingField {
  id: string;
  label: string;
  type: 'text' | 'date' | 'select';
  options?: string[];
  required?: boolean;
}

export interface RepeatingEntry {
  entryId: string;
  fields: Record<string, string>;
}

interface RepeatingGroupProps {
  groupId: string;
  title: string;
  description?: string;
  fields: RepeatingField[];
  entries: RepeatingEntry[];
  onAdd: (entry: RepeatingEntry) => void;
  onUpdate: (entryId: string, entry: RepeatingEntry) => void;
  onDelete: (entryId: string) => void;
  maxEntries?: number;
}

export function RepeatingGroup({
  groupId,
  title,
  description,
  fields,
  entries,
  onAdd,
  onUpdate,
  onDelete,
  maxEntries,
}: RepeatingGroupProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});

  const startAdd = () => {
    setFormData({});
    setIsAdding(true);
    setEditingId(null);
  };

  const startEdit = (entry: RepeatingEntry) => {
    setFormData({ ...entry.fields });
    setEditingId(entry.entryId);
    setIsAdding(false);
  };

  const cancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({});
  };

  const save = () => {
    // Validate required fields
    for (const field of fields) {
      if (field.required && !formData[field.id]?.trim()) {
        alert(`Please provide: ${field.label}`);
        return;
      }
    }

    if (editingId) {
      onUpdate(editingId, { entryId: editingId, fields: { ...formData } });
    } else {
      onAdd({
        entryId: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        fields: { ...formData },
      });
    }
    cancel();
  };

  const canAddMore = !maxEntries || entries.length < maxEntries;
  const showForm = isAdding || editingId !== null;

  return (
    <div className="repeating-group" data-group-id={groupId} data-testid={`repeating-group-${groupId}`}>
      <h3>{title}</h3>
      {description && <p className="group-description">{description}</p>}

      {/* Summary of entries */}
      {entries.length > 0 && (
        <div className="entries-summary">
          <h4>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </h4>
          {entries.map((entry, idx) => (
            <div key={entry.entryId} className="entry-card">
              <div className="entry-header">
                <strong>
                  {title} #{idx + 1}
                </strong>
                <div className="entry-actions">
                  <button
                    type="button"
                    onClick={() => startEdit(entry)}
                    className="btn-edit"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete this ${title.toLowerCase()} entry?`)) {
                        onDelete(entry.entryId);
                      }
                    }}
                    className="btn-delete"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="entry-fields">
                {fields.map((field) => (
                  <div key={field.id} className="entry-field">
                    <span className="field-label">{field.label}:</span>{' '}
                    <span className="field-value">
                      {entry.fields[field.id] || <em>Not provided</em>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit form */}
      {showForm ? (
        <div className="entry-form">
          <h4>{editingId ? 'Edit' : 'Add'} {title}</h4>
          {fields.map((field) => (
            <div key={field.id} className="form-field">
              <label htmlFor={`${groupId}-${field.id}`}>
                {field.label}
                {field.required && <span className="required">*</span>}
              </label>
              {field.type === 'select' && field.options ? (
                <select
                  id={`${groupId}-${field.id}`}
                  data-testid={`entry-input-${field.id}`}
                  value={formData[field.id] || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, [field.id]: e.target.value })
                  }
                >
                  <option value="">Select...</option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'date' ? 'date' : 'text'}
                  id={`${groupId}-${field.id}`}
                  data-testid={`entry-input-${field.id}`}
                  value={formData[field.id] || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, [field.id]: e.target.value })
                  }
                  placeholder={field.label}
                />
              )}
            </div>
          ))}
          <div className="form-actions">
            <button type="button" onClick={save} className="btn-save" data-testid="btn-save-entry">
              {editingId ? 'Save Changes' : 'Add Entry'}
            </button>
            <button type="button" onClick={cancel} className="btn-cancel">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        canAddMore && (
          <button type="button" onClick={startAdd} className="btn-add-another" data-testid="btn-add-entry">
            + Add Another {title}
          </button>
        )
      )}

      {!canAddMore && maxEntries && (
        <p className="max-reached">
          Maximum {maxEntries} entries reached. Additional entries will go to
          the supplement.
        </p>
      )}
    </div>
  );
}

/**
 * Pre-configured field sets for I-589 repeating groups.
 */
export const ENTRY_HISTORY_FIELDS: RepeatingField[] = [
  { id: 'entry_place', label: 'Place of entry', type: 'text', required: true },
  { id: 'entry_date', label: 'Date of entry', type: 'date', required: true },
  { id: 'entry_status', label: 'Status at entry', type: 'text' },
  { id: 'entry_manner', label: 'Manner of entry', type: 'text' },
];

export const ADDRESS_FIELDS: RepeatingField[] = [
  { id: 'street', label: 'Street address', type: 'text', required: true },
  { id: 'city', label: 'City', type: 'text', required: true },
  { id: 'region', label: 'State/Province', type: 'text' },
  { id: 'country', label: 'Country', type: 'text', required: true },
  { id: 'from_date', label: 'From date', type: 'date' },
  { id: 'to_date', label: 'To date', type: 'date' },
];

export const CHILD_FIELDS: RepeatingField[] = [
  { id: 'family_name', label: "Child's last name", type: 'text', required: true },
  { id: 'given_name', label: "Child's first name", type: 'text', required: true },
  { id: 'middle_name', label: "Child's middle name", type: 'text' },
  { id: 'date_of_birth', label: 'Date of birth', type: 'date', required: true },
  { id: 'nationality', label: 'Nationality', type: 'text' },
  { id: 'birth_city', label: 'City of birth', type: 'text' },
  {
    id: 'sex',
    label: 'Sex',
    type: 'select',
    options: ['Male', 'Female'],
  },
];
