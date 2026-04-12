"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NodeExecutionData } from "@/components/editor/EditorShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type {
  ProgramSchema,
  AgentConfig,
  StepConfig,
  TriggerConfig,
  BranchCondition,
  ConnectionConfig,
  HttpConnectionConfig,
  RetryConfig,
} from "@flowos/schema";
import type { ValidationResult, ValidationError, ValidationWarning } from "@/lib/validation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  provider: string;
}

export interface SidebarConnection {
  name: string;
  provider: string;
  scopes: string[];
}

interface NodeSidebarProps {
  nodeId: string;
  schema: ProgramSchema;
  programId: string;
  apiKeys: ApiKey[];
  connections: SidebarConnection[];
  validationResult?: ValidationResult | null;
  /** Execution data keyed by node_id, populated from the latest run. */
  nodeExecutions?: Record<string, NodeExecutionData>;
  /** The ID of the most recent run, used to build the "View full run" link. */
  lastRunId?: string | null;
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
}

// ─── Operations catalog — exact match with runtime connectors ─────────────────

const CONNECTOR_OPERATIONS: Record<string, string[]> = {
  // ── Implemented connectors ──────────────────────────────────────────────────
  gmail:    ["list_emails", "list_threads", "search", "read_email", "get_attachment", "send_email", "archive_email", "label_email"],
  notion:   ["read_page", "create_page", "append_to_page", "query_database", "create_database_entry"],
  slack:    ["send_message", "read_channel", "list_channels", "create_channel"],
  github:   ["create_issue", "comment_on_issue", "list_prs", "get_pr_diff", "push_file"],
  sheets:   ["read_range", "write_range", "append_row", "list_sheets", "create_sheet", "clear_range"],
  // ── Connectors planned (operations will work once connector is added) ────────
  calendar: ["list_events", "get_event", "create_event", "update_event", "delete_event"],
  docs:     ["read_document", "create_document", "append_to_document", "replace_text"],
  drive:    ["list_files", "get_file_metadata", "create_folder", "delete_file", "share_file"],
  airtable: ["list_records", "get_record", "create_record", "update_record", "delete_record"],
  hubspot:  ["list_contacts", "get_contact", "create_contact", "update_contact", "list_deals", "create_deal", "update_deal"],
  typeform: ["list_forms", "get_form", "list_responses"],
  asana:    ["list_tasks", "get_task", "create_task", "update_task", "complete_task", "list_projects"],
  outlook:  ["list_emails", "read_email", "send_email", "reply_email", "delete_email", "list_folders", "move_email"],
};

// ─── Structured param schemas per provider+operation ──────────────────────────

type ParamFieldType = "string" | "text" | "number" | "boolean" | "json" | "array";

interface ParamField {
  key: string;
  label: string;
  type: ParamFieldType;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}

const OPERATION_PARAM_FIELDS: Record<string, Record<string, ParamField[]>> = {
  gmail: {
    list_emails: [
      { key: "query", label: "Query", type: "string", placeholder: "from:user@example.com is:unread" },
      { key: "max_results", label: "Max results", type: "number", placeholder: "10" },
      { key: "label_ids", label: "Label IDs", type: "array", placeholder: "INBOX, UNREAD" },
    ],
    list_threads: [
      { key: "query", label: "Query", type: "string", placeholder: "subject:invoice" },
      { key: "max_results", label: "Max results", type: "number", placeholder: "10" },
    ],
    search: [
      { key: "query", label: "Search query", type: "string", placeholder: "has:attachment newer_than:7d", required: true },
      { key: "max_results", label: "Max results", type: "number", placeholder: "20" },
    ],
    read_email: [
      { key: "message_id", label: "Message ID", type: "string", placeholder: "18e3f1a2b3c4d5e6", required: true },
    ],
    get_attachment: [
      { key: "message_id", label: "Message ID", type: "string", required: true },
      { key: "attachment_id", label: "Attachment ID", type: "string", required: true },
    ],
    send_email: [
      { key: "to", label: "To", type: "string", placeholder: "alice@example.com", required: true },
      { key: "subject", label: "Subject", type: "string", required: true },
      { key: "body", label: "Body", type: "text", required: true },
      { key: "cc", label: "CC", type: "string", placeholder: "bob@example.com" },
      { key: "bcc", label: "BCC", type: "string" },
      { key: "is_html", label: "HTML body", type: "boolean" },
    ],
    archive_email: [
      { key: "message_id", label: "Message ID", type: "string", required: true },
    ],
    label_email: [
      { key: "message_id", label: "Message ID", type: "string", required: true },
      { key: "label_ids", label: "Add labels", type: "array", placeholder: "STARRED, Label_123" },
      { key: "remove_label_ids", label: "Remove labels", type: "array", placeholder: "UNREAD" },
    ],
  },
  notion: {
    read_page: [
      { key: "page_id", label: "Page ID", type: "string", placeholder: "a1b2c3d4-...", required: true },
    ],
    create_page: [
      { key: "parent_id", label: "Parent page/DB ID", type: "string", required: true },
      { key: "title", label: "Title", type: "string", required: true },
      { key: "content", label: "Initial content (Markdown)", type: "text" },
    ],
    append_to_page: [
      { key: "page_id", label: "Page ID", type: "string", required: true },
      { key: "content", label: "Content (Markdown)", type: "text", required: true },
    ],
    query_database: [
      { key: "database_id", label: "Database ID", type: "string", required: true },
      { key: "filter", label: "Filter", type: "json", hint: "Notion filter object" },
      { key: "sorts", label: "Sorts", type: "json", hint: "Array of sort objects" },
      { key: "page_size", label: "Page size", type: "number", placeholder: "100" },
    ],
    create_database_entry: [
      { key: "database_id", label: "Database ID", type: "string", required: true },
      { key: "properties", label: "Properties", type: "json", required: true, hint: "Notion properties object" },
    ],
  },
  slack: {
    send_message: [
      { key: "channel", label: "Channel", type: "string", placeholder: "#general or C123ABC", required: true },
      { key: "text", label: "Message text", type: "text", required: true },
      { key: "blocks", label: "Block Kit blocks", type: "json", hint: "Optional rich layout blocks" },
    ],
    read_channel: [
      { key: "channel", label: "Channel ID", type: "string", required: true },
      { key: "limit", label: "Message limit", type: "number", placeholder: "50" },
    ],
    list_channels: [
      { key: "types", label: "Types", type: "string", placeholder: "public_channel,private_channel" },
      { key: "limit", label: "Limit", type: "number", placeholder: "100" },
    ],
    create_channel: [
      { key: "name", label: "Channel name", type: "string", placeholder: "my-channel", required: true },
      { key: "is_private", label: "Private channel", type: "boolean" },
    ],
  },
  github: {
    create_issue: [
      { key: "owner", label: "Owner", type: "string", placeholder: "octocat", required: true },
      { key: "repo", label: "Repository", type: "string", placeholder: "my-repo", required: true },
      { key: "title", label: "Title", type: "string", required: true },
      { key: "body", label: "Body", type: "text" },
      { key: "labels", label: "Labels", type: "array", placeholder: "bug, enhancement" },
    ],
    comment_on_issue: [
      { key: "owner", label: "Owner", type: "string", required: true },
      { key: "repo", label: "Repository", type: "string", required: true },
      { key: "issue_number", label: "Issue number", type: "number", required: true },
      { key: "body", label: "Comment body", type: "text", required: true },
    ],
    list_prs: [
      { key: "owner", label: "Owner", type: "string", required: true },
      { key: "repo", label: "Repository", type: "string", required: true },
      { key: "state", label: "State", type: "string", placeholder: "open" },
    ],
    get_pr_diff: [
      { key: "owner", label: "Owner", type: "string", required: true },
      { key: "repo", label: "Repository", type: "string", required: true },
      { key: "pull_number", label: "PR number", type: "number", required: true },
    ],
    push_file: [
      { key: "owner", label: "Owner", type: "string", required: true },
      { key: "repo", label: "Repository", type: "string", required: true },
      { key: "path", label: "File path", type: "string", placeholder: "src/hello.txt", required: true },
      { key: "content", label: "File content", type: "text", required: true },
      { key: "message", label: "Commit message", type: "string", required: true },
      { key: "branch", label: "Branch", type: "string", placeholder: "main" },
    ],
  },
  sheets: {
    read_range: [
      { key: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true },
      { key: "range", label: "Range", type: "string", placeholder: "Sheet1!A1:D100", required: true },
    ],
    write_range: [
      { key: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true },
      { key: "range", label: "Range", type: "string", placeholder: "Sheet1!A1", required: true },
      { key: "values", label: "Values (2D array)", type: "json", required: true, hint: '[[\"a\",\"b\"],[\"c\",\"d\"]]' },
    ],
    append_row: [
      { key: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true },
      { key: "range", label: "Range / sheet name", type: "string", placeholder: "Sheet1", required: true },
      { key: "values", label: "Row values", type: "json", required: true, hint: '[[\"val1\",\"val2\"]]' },
    ],
    list_sheets: [
      { key: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true },
    ],
    create_sheet: [
      { key: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true },
      { key: "title", label: "Sheet title", type: "string", required: true },
    ],
    clear_range: [
      { key: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true },
      { key: "range", label: "Range", type: "string", placeholder: "Sheet1!A1:Z100", required: true },
    ],
  },
  calendar: {
    list_events: [
      { key: "calendar_id", label: "Calendar ID", type: "string", placeholder: "primary" },
      { key: "time_min", label: "From (ISO 8601)", type: "string", placeholder: "2024-01-01T00:00:00Z" },
      { key: "time_max", label: "To (ISO 8601)", type: "string" },
      { key: "max_results", label: "Max results", type: "number", placeholder: "10" },
    ],
    get_event: [
      { key: "event_id", label: "Event ID", type: "string", required: true },
      { key: "calendar_id", label: "Calendar ID", type: "string", placeholder: "primary" },
    ],
    create_event: [
      { key: "calendar_id", label: "Calendar ID", type: "string", placeholder: "primary" },
      { key: "summary", label: "Title", type: "string", required: true },
      { key: "start", label: "Start (ISO 8601)", type: "string", required: true },
      { key: "end", label: "End (ISO 8601)", type: "string", required: true },
      { key: "description", label: "Description", type: "text" },
      { key: "attendees", label: "Attendees", type: "json", hint: '[{"email":"a@b.com"}]' },
    ],
    update_event: [
      { key: "calendar_id", label: "Calendar ID", type: "string", placeholder: "primary" },
      { key: "event_id", label: "Event ID", type: "string", required: true },
      { key: "summary", label: "Title", type: "string" },
      { key: "start", label: "Start (ISO 8601)", type: "string" },
      { key: "end", label: "End (ISO 8601)", type: "string" },
    ],
    delete_event: [
      { key: "calendar_id", label: "Calendar ID", type: "string", placeholder: "primary" },
      { key: "event_id", label: "Event ID", type: "string", required: true },
    ],
  },
  docs: {
    read_document: [
      { key: "document_id", label: "Document ID", type: "string", required: true },
    ],
    create_document: [
      { key: "title", label: "Title", type: "string", required: true },
      { key: "content", label: "Initial content", type: "text" },
    ],
    append_to_document: [
      { key: "document_id", label: "Document ID", type: "string", required: true },
      { key: "content", label: "Content to append", type: "text", required: true },
    ],
    replace_text: [
      { key: "document_id", label: "Document ID", type: "string", required: true },
      { key: "search_text", label: "Search text", type: "string", required: true },
      { key: "replacement", label: "Replacement text", type: "string", required: true },
    ],
  },
  drive: {
    list_files: [
      { key: "query", label: "Query", type: "string", placeholder: "name contains 'report' and trashed=false" },
      { key: "page_size", label: "Page size", type: "number", placeholder: "20" },
    ],
    get_file_metadata: [
      { key: "file_id", label: "File ID", type: "string", required: true },
    ],
    create_folder: [
      { key: "name", label: "Folder name", type: "string", required: true },
      { key: "parent_id", label: "Parent folder ID", type: "string" },
    ],
    delete_file: [
      { key: "file_id", label: "File ID", type: "string", required: true },
    ],
    share_file: [
      { key: "file_id", label: "File ID", type: "string", required: true },
      { key: "email", label: "Share with (email)", type: "string", required: true },
      { key: "role", label: "Role", type: "string", placeholder: "writer" },
    ],
  },
  airtable: {
    list_records: [
      { key: "base_id", label: "Base ID", type: "string", placeholder: "appXXXXXXXX", required: true },
      { key: "table_name", label: "Table name", type: "string", required: true },
      { key: "filter_formula", label: "Filter formula", type: "string", placeholder: 'NOT({Status}="Done")' },
      { key: "max_records", label: "Max records", type: "number", placeholder: "100" },
    ],
    get_record: [
      { key: "base_id", label: "Base ID", type: "string", required: true },
      { key: "table_name", label: "Table name", type: "string", required: true },
      { key: "record_id", label: "Record ID", type: "string", required: true },
    ],
    create_record: [
      { key: "base_id", label: "Base ID", type: "string", required: true },
      { key: "table_name", label: "Table name", type: "string", required: true },
      { key: "fields", label: "Fields", type: "json", required: true, hint: '{"Name":"Alice","Status":"Active"}' },
    ],
    update_record: [
      { key: "base_id", label: "Base ID", type: "string", required: true },
      { key: "table_name", label: "Table name", type: "string", required: true },
      { key: "record_id", label: "Record ID", type: "string", required: true },
      { key: "fields", label: "Fields to update", type: "json", required: true },
    ],
    delete_record: [
      { key: "base_id", label: "Base ID", type: "string", required: true },
      { key: "table_name", label: "Table name", type: "string", required: true },
      { key: "record_id", label: "Record ID", type: "string", required: true },
    ],
  },
  hubspot: {
    list_contacts: [
      { key: "limit", label: "Limit", type: "number", placeholder: "100" },
      { key: "properties", label: "Properties", type: "array", placeholder: "email, firstname, lastname" },
      { key: "after", label: "After (cursor)", type: "string" },
    ],
    get_contact: [
      { key: "contact_id", label: "Contact ID", type: "string", required: true },
    ],
    create_contact: [
      { key: "properties", label: "Properties", type: "json", required: true, hint: '{"email":"a@b.com","firstname":"Alice"}' },
    ],
    update_contact: [
      { key: "contact_id", label: "Contact ID", type: "string", required: true },
      { key: "properties", label: "Properties to update", type: "json", required: true },
    ],
    list_deals: [
      { key: "limit", label: "Limit", type: "number", placeholder: "100" },
      { key: "after", label: "After (cursor)", type: "string" },
    ],
    create_deal: [
      { key: "properties", label: "Properties", type: "json", required: true, hint: '{"dealname":"Big Deal","amount":"10000"}' },
    ],
    update_deal: [
      { key: "deal_id", label: "Deal ID", type: "string", required: true },
      { key: "properties", label: "Properties to update", type: "json", required: true },
    ],
  },
  typeform: {
    list_forms: [
      { key: "page", label: "Page", type: "number", placeholder: "1" },
      { key: "page_size", label: "Page size", type: "number", placeholder: "10" },
    ],
    get_form: [
      { key: "form_id", label: "Form ID", type: "string", required: true },
    ],
    list_responses: [
      { key: "form_id", label: "Form ID", type: "string", required: true },
      { key: "page_size", label: "Page size", type: "number", placeholder: "25" },
      { key: "since", label: "Since (ISO 8601)", type: "string" },
      { key: "until", label: "Until (ISO 8601)", type: "string" },
      { key: "completed", label: "Completed only", type: "boolean" },
    ],
  },
  asana: {
    list_tasks: [
      { key: "project_id", label: "Project ID", type: "string", required: true },
      { key: "assignee", label: "Assignee (email or GID)", type: "string" },
      { key: "completed_since", label: "Completed since (ISO 8601)", type: "string" },
    ],
    get_task: [
      { key: "task_id", label: "Task GID", type: "string", required: true },
    ],
    create_task: [
      { key: "workspace_id", label: "Workspace GID", type: "string", required: true },
      { key: "name", label: "Task name", type: "string", required: true },
      { key: "notes", label: "Notes", type: "text" },
      { key: "due_on", label: "Due date (YYYY-MM-DD)", type: "string" },
      { key: "assignee", label: "Assignee (email or GID)", type: "string" },
      { key: "projects", label: "Project GIDs", type: "array" },
    ],
    update_task: [
      { key: "task_id", label: "Task GID", type: "string", required: true },
      { key: "name", label: "Name", type: "string" },
      { key: "notes", label: "Notes", type: "text" },
      { key: "due_on", label: "Due date (YYYY-MM-DD)", type: "string" },
      { key: "completed", label: "Completed", type: "boolean" },
    ],
    complete_task: [
      { key: "task_id", label: "Task GID", type: "string", required: true },
    ],
    list_projects: [
      { key: "workspace_id", label: "Workspace GID", type: "string", required: true },
    ],
  },
  outlook: {
    list_emails: [
      { key: "folder", label: "Folder", type: "string", placeholder: "Inbox" },
      { key: "top", label: "Max messages", type: "number", placeholder: "20" },
      { key: "filter", label: "OData filter", type: "string", placeholder: "isRead eq false" },
    ],
    read_email: [
      { key: "message_id", label: "Message ID", type: "string", required: true },
    ],
    send_email: [
      { key: "to", label: "To (email)", type: "string", required: true },
      { key: "subject", label: "Subject", type: "string", required: true },
      { key: "body", label: "Body", type: "text", required: true },
      { key: "cc", label: "CC", type: "string" },
      { key: "is_html", label: "HTML body", type: "boolean" },
    ],
    reply_email: [
      { key: "message_id", label: "Message ID", type: "string", required: true },
      { key: "comment", label: "Reply text", type: "text", required: true },
    ],
    delete_email: [
      { key: "message_id", label: "Message ID", type: "string", required: true },
    ],
    list_folders: [],
    move_email: [
      { key: "message_id", label: "Message ID", type: "string", required: true },
      { key: "destination_folder", label: "Destination folder", type: "string", placeholder: "archive", required: true, hint: 'Folder ID or well-known name: inbox, archive, deleteditems, sentitems' },
    ],
  },
};

// ─── Required scopes per provider+operation ───────────────────────────────────

const OPERATION_SCOPES: Record<string, Record<string, string[]>> = {
  gmail: {
    list_emails:    ["https://www.googleapis.com/auth/gmail.readonly"],
    list_threads:   ["https://www.googleapis.com/auth/gmail.readonly"],
    search:         ["https://www.googleapis.com/auth/gmail.readonly"],
    read_email:     ["https://www.googleapis.com/auth/gmail.readonly"],
    get_attachment: ["https://www.googleapis.com/auth/gmail.readonly"],
    send_email:     ["https://www.googleapis.com/auth/gmail.send"],
    archive_email:  ["https://www.googleapis.com/auth/gmail.modify"],
    label_email:    ["https://www.googleapis.com/auth/gmail.modify"],
  },
  notion: {
    read_page:             [],
    query_database:        [],
    create_page:           [],
    append_to_page:        [],
    create_database_entry: [],
    create_database:       [],
  },
  slack: {
    send_message:   ["chat:write"],
    read_channel:   ["channels:history", "groups:history"],
    list_channels:  ["channels:read"],
    create_channel: ["channels:manage"],
  },
  github: {
    create_issue:     ["repo"],
    comment_on_issue: ["repo"],
    list_prs:         ["repo"],
    get_pr_diff:      ["repo"],
    push_file:        ["repo"],
  },
  sheets: {
    read_range:  ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    list_sheets: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    write_range: ["https://www.googleapis.com/auth/spreadsheets"],
    append_row:  ["https://www.googleapis.com/auth/spreadsheets"],
    create_sheet:["https://www.googleapis.com/auth/spreadsheets"],
    clear_range: ["https://www.googleapis.com/auth/spreadsheets"],
  },
  calendar: {
    list_events:  ["https://www.googleapis.com/auth/calendar.readonly"],
    get_event:    ["https://www.googleapis.com/auth/calendar.readonly"],
    create_event: ["https://www.googleapis.com/auth/calendar"],
    update_event: ["https://www.googleapis.com/auth/calendar"],
    delete_event: ["https://www.googleapis.com/auth/calendar"],
  },
  docs: {
    read_document:      ["https://www.googleapis.com/auth/documents.readonly"],
    create_document:    ["https://www.googleapis.com/auth/documents"],
    append_to_document: ["https://www.googleapis.com/auth/documents"],
    replace_text:       ["https://www.googleapis.com/auth/documents"],
  },
  drive: {
    list_files:        ["https://www.googleapis.com/auth/drive.readonly"],
    get_file_metadata: ["https://www.googleapis.com/auth/drive.readonly"],
    create_folder:     ["https://www.googleapis.com/auth/drive"],
    share_file:        ["https://www.googleapis.com/auth/drive"],
    delete_file:       ["https://www.googleapis.com/auth/drive"],
  },
  airtable: {
    list_records:  ["data.records:read", "schema.bases:read"],
    get_record:    ["data.records:read", "schema.bases:read"],
    create_record: ["data.records:read", "data.records:write", "schema.bases:read"],
    update_record: ["data.records:read", "data.records:write", "schema.bases:read"],
    delete_record: ["data.records:read", "data.records:write", "schema.bases:read"],
  },
  hubspot: {
    list_contacts:  ["crm.objects.contacts.read"],
    get_contact:    ["crm.objects.contacts.read"],
    create_contact: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    update_contact: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    list_deals:     ["crm.objects.deals.read"],
    create_deal:    ["crm.objects.deals.read", "crm.objects.deals.write"],
    update_deal:    ["crm.objects.deals.read", "crm.objects.deals.write"],
  },
  typeform: {
    list_forms:     ["forms:read"],
    get_form:       ["forms:read"],
    list_responses: ["responses:read", "forms:read"],
  },
  asana: {
    list_projects: ["default"],
    list_tasks:    ["default"],
    get_task:      ["default"],
    create_task:   ["default"],
    update_task:   ["default"],
    complete_task: ["default"],
  },
  outlook: {
    list_emails:  ["Mail.Read"],
    read_email:   ["Mail.Read"],
    send_email:   ["Mail.Send"],
    reply_email:  ["Mail.Send"],
    delete_email: ["Mail.ReadWrite"],
    list_folders: ["Mail.Read"],
    move_email:   ["Mail.ReadWrite"],
  },
};

// ─── Cron presets ─────────────────────────────────────────────────────────────

const CRON_PRESETS: { label: string; expression: string }[] = [
  { label: "Every minute",    expression: "* * * * *" },
  { label: "Every 5 min",     expression: "*/5 * * * *" },
  { label: "Every 15 min",    expression: "*/15 * * * *" },
  { label: "Hourly",          expression: "0 * * * *" },
  { label: "Daily 8am",       expression: "0 8 * * *" },
  { label: "Daily midnight",  expression: "0 0 * * *" },
  { label: "Weekdays 9am",    expression: "0 9 * * 1-5" },
  { label: "Mon 9am",         expression: "0 9 * * 1" },
  { label: "Monthly 1st",     expression: "0 0 1 * *" },
];

// ─── Model presets per provider ───────────────────────────────────────────────

const MODEL_PRESETS: Record<string, string[]> = {
  anthropic:  ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai:     ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"],
  openrouter: [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "mistralai/mistral-7b-instruct:free",
    "google/gemini-flash-1.5-8b",
    "deepseek/deepseek-chat",
    "anthropic/claude-haiku-4-5-20251001",
    "openai/gpt-4o-mini",
  ],
  google:     ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro"],
  groq:       ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
  mistral:    ["mistral-large-latest", "mistral-small-latest", "open-mixtral-8x22b"],
  cohere:     ["command-r-plus", "command-r"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
        {title}
      </h4>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldGroup({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="text-xs cursor-pointer">
        {label}
      </Label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-1"
          )}
        />
      </button>
    </div>
  );
}

// ─── Validation summary ───────────────────────────────────────────────────────

function ValidationSummary({
  errors,
  warnings,
}: {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {errors.map((e, i) => (
        <div
          key={i}
          className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2"
        >
          <p className="text-xs font-medium text-red-700 dark:text-red-400">{e.message}</p>
          {e.fix_suggestion && (
            <p className="text-[10px] text-red-600/80 dark:text-red-500 mt-0.5">{e.fix_suggestion}</p>
          )}
        </div>
      ))}
      {warnings.map((w, i) => (
        <div
          key={i}
          className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2"
        >
          <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">{w.message}</p>
          {w.fix_suggestion && (
            <p className="text-[10px] text-yellow-600/80 dark:text-yellow-500 mt-0.5">{w.fix_suggestion}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Operation params editor ─────────────────────────────────────────────────

function OperationParamsEditor({
  provider,
  operation,
  params,
  onChange,
}: {
  provider: string;
  operation: string;
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const fields = OPERATION_PARAM_FIELDS[provider]?.[operation];

  // JSON fallback state for JSON-type fields and for unknown operations
  const [jsonFallback, setJsonFallback] = useState(() => JSON.stringify(params, null, 2));
  const [jsonError, setJsonError] = useState(false);

  // Keep json fallback in sync when operation changes
  useEffect(() => {
    setJsonFallback(JSON.stringify(params, null, 2));
    setJsonError(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation]);

  if (!fields) {
    // Unknown operation — raw JSON editor
    return (
      <FieldGroup label="Operation params (JSON)" htmlFor="op-params-raw">
        <Textarea
          id="op-params-raw"
          rows={5}
          className={cn("text-xs font-mono resize-y", jsonError && "border-destructive")}
          value={jsonFallback}
          onChange={(e) => setJsonFallback(e.target.value)}
          onBlur={() => {
            try {
              onChange(JSON.parse(jsonFallback));
              setJsonError(false);
            } catch {
              setJsonError(true);
            }
          }}
          placeholder="{}"
        />
        {jsonError && <p className="text-xs text-destructive">Invalid JSON</p>}
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Use <span className="font-mono">{"{{node_id.field}}"}</span> to reference upstream outputs.
        </p>
      </FieldGroup>
    );
  }

  function update(key: string, value: unknown) {
    const next = { ...params };
    if (value === "" || value === undefined || value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const rawVal = params[field.key];
        const labelEl = (
          <span>
            {field.label}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </span>
        );

        if (field.type === "boolean") {
          return (
            <Toggle
              key={field.key}
              id={`op-${field.key}`}
              checked={Boolean(rawVal)}
              onChange={(v) => update(field.key, v)}
              label={field.label}
            />
          );
        }

        if (field.type === "text") {
          return (
            <FieldGroup key={field.key} htmlFor={`op-${field.key}`} hint={field.hint}>
              <Label htmlFor={`op-${field.key}`} className="text-xs">{labelEl}</Label>
              <Textarea
                id={`op-${field.key}`}
                rows={3}
                className="text-xs resize-y"
                placeholder={field.placeholder}
                value={String(rawVal ?? "")}
                onChange={(e) => update(field.key, e.target.value)}
              />
            </FieldGroup>
          );
        }

        if (field.type === "number") {
          return (
            <FieldGroup key={field.key} htmlFor={`op-${field.key}`} hint={field.hint}>
              <Label htmlFor={`op-${field.key}`} className="text-xs">{labelEl}</Label>
              <Input
                id={`op-${field.key}`}
                type="number"
                placeholder={field.placeholder}
                value={rawVal !== undefined ? String(rawVal) : ""}
                onChange={(e) => update(field.key, e.target.value ? Number(e.target.value) : undefined)}
              />
            </FieldGroup>
          );
        }

        if (field.type === "array") {
          const arrVal = Array.isArray(rawVal) ? (rawVal as string[]).join(", ") : String(rawVal ?? "");
          return (
            <FieldGroup key={field.key} htmlFor={`op-${field.key}`} hint={field.hint ?? "Comma-separated"}>
              <Label htmlFor={`op-${field.key}`} className="text-xs">{labelEl}</Label>
              <Input
                id={`op-${field.key}`}
                placeholder={field.placeholder ?? "item1, item2"}
                value={arrVal}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  update(field.key, v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
                }}
              />
            </FieldGroup>
          );
        }

        if (field.type === "json") {
          const jsonVal = rawVal !== undefined
            ? (typeof rawVal === "string" ? rawVal : JSON.stringify(rawVal, null, 2))
            : "";
          return (
            <JsonField
              key={field.key}
              fieldKey={field.key}
              label={labelEl}
              hint={field.hint}
              value={jsonVal}
              onCommit={(v) => {
                try {
                  update(field.key, v ? JSON.parse(v) : undefined);
                } catch {
                  // keep old value
                }
              }}
            />
          );
        }

        // Default: string input
        return (
          <FieldGroup key={field.key} htmlFor={`op-${field.key}`} hint={field.hint}>
            <Label htmlFor={`op-${field.key}`} className="text-xs">{labelEl}</Label>
            <Input
              id={`op-${field.key}`}
              placeholder={field.placeholder}
              value={String(rawVal ?? "")}
              onChange={(e) => update(field.key, e.target.value)}
            />
          </FieldGroup>
        );
      })}
      <p className="text-[11px] text-muted-foreground pt-1">
        Use <span className="font-mono text-[11px]">{"{{node_id.field}}"}</span> to reference upstream outputs.
      </p>
    </div>
  );
}

// Small controlled JSON textarea that tracks local state independently
function JsonField({
  fieldKey,
  label,
  hint,
  value,
  onCommit,
}: {
  fieldKey: string;
  label: React.ReactNode;
  hint?: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const [err, setErr] = useState(false);

  useEffect(() => { setLocal(value); setErr(false); }, [value]);

  return (
    <FieldGroup htmlFor={`op-${fieldKey}`} hint={hint}>
      <Label htmlFor={`op-${fieldKey}`} className="text-xs">{label}</Label>
      <Textarea
        id={`op-${fieldKey}`}
        rows={3}
        className={cn("text-xs font-mono resize-y", err && "border-destructive")}
        value={local}
        placeholder="{}"
        onChange={(e) => { setLocal(e.target.value); setErr(false); }}
        onBlur={() => {
          try { JSON.parse(local || "null"); setErr(false); onCommit(local); }
          catch { setErr(true); }
        }}
      />
      {err && <p className="text-xs text-destructive">Invalid JSON</p>}
    </FieldGroup>
  );
}

// ─── Agent sidebar ────────────────────────────────────────────────────────────

type AgentTab = "model" | "prompt" | "retry";

function AgentSidebar({
  config,
  apiKeys,
  onUpdate,
}: {
  config: AgentConfig;
  apiKeys: ApiKey[];
  onUpdate: (patch: Partial<AgentConfig>) => void;
}) {
  const [tab, setTab] = useState<AgentTab>("model");

  const selectedKey = apiKeys.find((k) => k.id === config.api_key_ref);
  const providerPresets = MODEL_PRESETS[selectedKey?.provider ?? ""] ?? [];
  const datalistId = "agent-model-presets";

  const tabs: { id: AgentTab; label: string }[] = [
    { id: "model", label: "Model" },
    { id: "prompt", label: "Prompt" },
    { id: "retry", label: "Retry" },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-border mb-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Model tab */}
      {tab === "model" && (
        <div className="space-y-3">
          <FieldGroup label="API Key" htmlFor="agent-apikey">
            <Select
              id="agent-apikey"
              value={config.api_key_ref === "__USER_ASSIGNED__" ? "" : config.api_key_ref}
              onChange={(e) => {
                const keyId = e.target.value || "__USER_ASSIGNED__";
                const updates: Partial<AgentConfig> = { api_key_ref: keyId };
                if (config.model === "__USER_ASSIGNED__" && keyId !== "__USER_ASSIGNED__") {
                  const selected = apiKeys.find((k) => k.id === keyId);
                  const presets = MODEL_PRESETS[selected?.provider ?? ""] ?? [];
                  if (presets.length > 0) updates.model = presets[0];
                }
                onUpdate(updates);
              }}
            >
              <option value="">— Select API Key —</option>
              {apiKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.provider})
                </option>
              ))}
            </Select>
          </FieldGroup>

          <FieldGroup label="Model" htmlFor="agent-model">
            {providerPresets.length > 0 && (
              <datalist id={datalistId}>
                {providerPresets.map((m) => <option key={m} value={m} />)}
              </datalist>
            )}
            <Input
              id="agent-model"
              list={providerPresets.length > 0 ? datalistId : undefined}
              placeholder="e.g. claude-opus-4-6"
              value={config.model === "__USER_ASSIGNED__" ? "" : config.model}
              onChange={(e) => onUpdate({ model: e.target.value || "__USER_ASSIGNED__" })}
            />
            {providerPresets.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {providerPresets.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onUpdate({ model: m })}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                      config.model === m
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {m.split("/").pop()}
                  </button>
                ))}
              </div>
            )}
          </FieldGroup>

          <FieldGroup label="Scope access" htmlFor="agent-scope">
            <Select
              id="agent-scope"
              value={config.scope_access}
              onChange={(e) =>
                onUpdate({ scope_access: e.target.value as AgentConfig["scope_access"] })
              }
            >
              <option value="read">Read</option>
              <option value="write">Write</option>
              <option value="read_write">Read + Write</option>
            </Select>
          </FieldGroup>
        </div>
      )}

      {/* Prompt tab */}
      {tab === "prompt" && (
        <div className="space-y-3">
          <FieldGroup label="System prompt" htmlFor="agent-prompt">
            <Textarea
              id="agent-prompt"
              rows={8}
              placeholder="Describe what this agent should do..."
              value={config.system_prompt}
              onChange={(e) => onUpdate({ system_prompt: e.target.value })}
              className="text-xs resize-none"
            />
          </FieldGroup>

          <Toggle
            id="agent-approval"
            checked={config.requires_approval}
            onChange={(v) => onUpdate({ requires_approval: v })}
            label="Requires human approval"
          />

          {config.requires_approval && (
            <FieldGroup label="Approval timeout (hours)" htmlFor="agent-approval-timeout">
              <Input
                id="agent-approval-timeout"
                type="number"
                min={0}
                value={config.approval_timeout_hours}
                onChange={(e) =>
                  onUpdate({ approval_timeout_hours: Number(e.target.value) })
                }
              />
            </FieldGroup>
          )}
        </div>
      )}

      {/* Retry tab */}
      {tab === "retry" && (
        <div className="space-y-3">
          <FieldGroup label="Max attempts (1–5)" htmlFor="retry-attempts">
            <Input
              id="retry-attempts"
              type="number"
              min={1}
              max={5}
              value={config.retry.max_attempts}
              onChange={(e) =>
                onUpdate({
                  retry: { ...config.retry, max_attempts: Math.min(5, Math.max(1, Number(e.target.value))) },
                })
              }
            />
          </FieldGroup>

          <FieldGroup label="Backoff strategy" htmlFor="retry-backoff">
            <Select
              id="retry-backoff"
              value={config.retry.backoff}
              onChange={(e) =>
                onUpdate({
                  retry: { ...config.retry, backoff: e.target.value as RetryConfig["backoff"] },
                })
              }
            >
              <option value="none">None</option>
              <option value="linear">Linear</option>
              <option value="exponential">Exponential</option>
            </Select>
          </FieldGroup>

          {config.retry.backoff !== "none" && (
            <FieldGroup label="Base seconds" htmlFor="retry-base">
              <Input
                id="retry-base"
                type="number"
                min={0}
                value={config.retry.backoff_base_seconds}
                onChange={(e) =>
                  onUpdate({
                    retry: { ...config.retry, backoff_base_seconds: Number(e.target.value) },
                  })
                }
              />
            </FieldGroup>
          )}

          <Toggle
            id="retry-fail"
            checked={config.retry.fail_program_on_exhaust}
            onChange={(v) =>
              onUpdate({ retry: { ...config.retry, fail_program_on_exhaust: v } })
            }
            label="Fail program when retries exhausted"
          />
        </div>
      )}
    </div>
  );
}

// ─── Trigger sidebar ──────────────────────────────────────────────────────────

function TriggerSidebar({
  config,
  onUpdate,
}: {
  config: TriggerConfig;
  onUpdate: (patch: Partial<TriggerConfig>) => void;
}) {
  const [showPresets, setShowPresets] = useState(false);

  return (
    <div className="space-y-3">
      <FieldGroup label="Trigger type" htmlFor="trigger-type">
        <Select
          id="trigger-type"
          value={config.trigger_type}
          onChange={(e) => {
            const t = e.target.value as TriggerConfig["trigger_type"];
            if (t === "manual")         onUpdate({ trigger_type: "manual" } as TriggerConfig);
            else if (t === "cron")      onUpdate({ trigger_type: "cron", expression: "", timezone: "UTC" } as TriggerConfig);
            else if (t === "webhook")   onUpdate({ trigger_type: "webhook", endpoint_id: "", method: "POST" } as TriggerConfig);
            else if (t === "event")     onUpdate({ trigger_type: "event", source: "", event: "", filter: null } as TriggerConfig);
            else if (t === "program_output") onUpdate({ trigger_type: "program_output", source_program_id: "", on_status: ["success"] } as TriggerConfig);
          }}
        >
          <option value="manual">Manual</option>
          <option value="cron">Cron schedule</option>
          <option value="webhook">Webhook</option>
          <option value="event">Event</option>
          <option value="program_output">Program output</option>
        </Select>
      </FieldGroup>

      {config.trigger_type === "cron" && (
        <>
          <FieldGroup label="Cron expression" htmlFor="cron-expr">
            <Input
              id="cron-expr"
              placeholder="0 9 * * 1-5"
              value={config.expression}
              onChange={(e) => onUpdate({ ...config, expression: e.target.value })}
            />
          </FieldGroup>

          {/* Presets */}
          <div>
            <button
              type="button"
              onClick={() => setShowPresets((v) => !v)}
              className="text-[11px] text-primary hover:underline"
            >
              {showPresets ? "Hide presets" : "Quick presets"}
            </button>
            {showPresets && (
              <div className="flex flex-wrap gap-1 mt-2">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.expression}
                    type="button"
                    onClick={() => onUpdate({ ...config, expression: p.expression })}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                      config.expression === p.expression
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <FieldGroup label="Timezone" htmlFor="cron-tz">
            <Input
              id="cron-tz"
              placeholder="UTC"
              value={config.timezone}
              onChange={(e) => onUpdate({ ...config, timezone: e.target.value })}
            />
          </FieldGroup>
        </>
      )}

      {config.trigger_type === "webhook" && (
        <>
          <FieldGroup label="HTTP method" htmlFor="webhook-method">
            <Select
              id="webhook-method"
              value={config.method}
              onChange={(e) =>
                onUpdate({ ...config, method: e.target.value as "POST" | "GET" })
              }
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </Select>
          </FieldGroup>
          {config.endpoint_id && (
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-[10px] text-muted-foreground">Endpoint ID</p>
              <p className="text-xs font-mono mt-0.5 break-all">{config.endpoint_id}</p>
            </div>
          )}
        </>
      )}

      {config.trigger_type === "event" && (
        <>
          <FieldGroup label="Source" htmlFor="event-source">
            <Input
              id="event-source"
              placeholder="e.g. gmail"
              value={config.source}
              onChange={(e) => onUpdate({ ...config, source: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Event name" htmlFor="event-name">
            <Input
              id="event-name"
              placeholder="e.g. message.received"
              value={config.event}
              onChange={(e) => onUpdate({ ...config, event: e.target.value })}
            />
          </FieldGroup>
        </>
      )}

      {config.trigger_type === "program_output" && (
        <>
          <FieldGroup label="Source program ID" htmlFor="prog-source">
            <Input
              id="prog-source"
              placeholder="Program UUID"
              value={config.source_program_id}
              onChange={(e) => onUpdate({ ...config, source_program_id: e.target.value })}
            />
          </FieldGroup>
          <div className="space-y-1">
            <Label className="text-xs">Fire on status</Label>
            {(["success", "failed", "partial"] as const).map((s) => {
              const active = config.on_status.includes(s);
              return (
                <Toggle
                  key={s}
                  id={`on-status-${s}`}
                  checked={active}
                  onChange={(v) => {
                    const next = v
                      ? [...config.on_status, s]
                      : config.on_status.filter((x) => x !== s);
                    onUpdate({ ...config, on_status: next });
                  }}
                  label={s.charAt(0).toUpperCase() + s.slice(1)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step sidebar ─────────────────────────────────────────────────────────────

const LOGIC_TYPE_OPTIONS: { value: StepConfig["logic_type"]; label: string; group: string }[] = [
  { value: "transform",   label: "Transform",   group: "Data" },
  { value: "filter",      label: "Filter",      group: "Data" },
  { value: "format",      label: "Format",      group: "Data" },
  { value: "parse",       label: "Parse",       group: "Data" },
  { value: "deduplicate", label: "Deduplicate", group: "Data" },
  { value: "sort",        label: "Sort",        group: "Data" },
  { value: "branch",      label: "Branch",      group: "Flow" },
  { value: "loop",        label: "Loop",        group: "Flow" },
  { value: "delay",       label: "Delay",       group: "Flow" },
];

function makeDefaultStepConfig(t: StepConfig["logic_type"]): StepConfig {
  switch (t) {
    case "transform":   return { logic_type: "transform", transformation: "", input_schema: null, output_schema: null };
    case "filter":      return { logic_type: "filter", condition: "", pass_schema: null };
    case "branch":      return { logic_type: "branch", conditions: [], default_branch: "" };
    case "delay":       return { logic_type: "delay", seconds: 5 };
    case "loop":        return { logic_type: "loop", over: "input.items", item_var: "item" };
    case "format":      return { logic_type: "format", template: "", output_key: "text" };
    case "parse":       return { logic_type: "parse", input_key: "text", format: "json" };
    case "deduplicate": return { logic_type: "deduplicate", key: "id" };
    case "sort":        return { logic_type: "sort", key: "id", order: "asc" };
  }
}

function StepSidebar({
  config,
  onUpdate,
}: {
  config: StepConfig;
  onUpdate: (patch: Partial<StepConfig>) => void;
}) {
  const [newCondition, setNewCondition] = useState("");
  const [newCondTarget, setNewCondTarget] = useState("");

  // Group options for the select
  const groupedOptions: Record<string, typeof LOGIC_TYPE_OPTIONS> = {};
  LOGIC_TYPE_OPTIONS.forEach((o) => {
    (groupedOptions[o.group] ??= []).push(o);
  });

  return (
    <div className="space-y-3">
      <FieldGroup label="Operation" htmlFor="step-logic">
        <Select
          id="step-logic"
          value={config.logic_type}
          onChange={(e) => onUpdate(makeDefaultStepConfig(e.target.value as StepConfig["logic_type"]))}
        >
          {Object.entries(groupedOptions).map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </Select>
      </FieldGroup>

      {/* ── Transform ── */}
      {config.logic_type === "transform" && (
        <FieldGroup
          label="Expression"
          htmlFor="step-transform"
          hint="JavaScript. input = upstream data. Return the new value."
        >
          <Textarea
            id="step-transform"
            rows={7}
            placeholder={"input.items.map(item => ({\n  id: item.id,\n  name: item.title,\n}))"}
            value={config.transformation}
            onChange={(e) => onUpdate({ ...config, transformation: e.target.value })}
            className="text-xs resize-y font-mono"
          />
        </FieldGroup>
      )}

      {/* ── Filter ── */}
      {config.logic_type === "filter" && (
        <FieldGroup
          label="Condition"
          htmlFor="step-filter"
          hint="True = pass data forward. False = stop execution."
        >
          <Input
            id="step-filter"
            placeholder="input.status === 'active' && input.score > 0.8"
            value={config.condition}
            onChange={(e) => onUpdate({ ...config, condition: e.target.value })}
          />
        </FieldGroup>
      )}

      {/* ── Branch ── */}
      {config.logic_type === "branch" && (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Conditions</Label>
            {config.conditions.map((cond: BranchCondition, i: number) => (
              <div key={i} className="flex gap-1.5 items-start">
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder="Condition expression"
                    value={cond.condition}
                    onChange={(e) => {
                      const next = [...config.conditions];
                      next[i] = { ...next[i], condition: e.target.value };
                      onUpdate({ ...config, conditions: next });
                    }}
                    className="text-xs"
                  />
                  <Input
                    placeholder="Target node ID"
                    value={cond.target_node_id}
                    onChange={(e) => {
                      const next = [...config.conditions];
                      next[i] = { ...next[i], target_node_id: e.target.value };
                      onUpdate({ ...config, conditions: next });
                    }}
                    className="text-xs"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onUpdate({ ...config, conditions: config.conditions.filter((_, j) => j !== i) })}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </Button>
              </div>
            ))}
            <div className="space-y-1.5 pt-1">
              <Input placeholder="Condition" value={newCondition} onChange={(e) => setNewCondition(e.target.value)} className="text-xs" />
              <Input placeholder="Target node ID" value={newCondTarget} onChange={(e) => setNewCondTarget(e.target.value)} className="text-xs" />
              <Button
                type="button" variant="outline" size="sm" className="w-full"
                disabled={!newCondition.trim() || !newCondTarget.trim()}
                onClick={() => {
                  onUpdate({ ...config, conditions: [...config.conditions, { condition: newCondition.trim(), target_node_id: newCondTarget.trim() }] });
                  setNewCondition(""); setNewCondTarget("");
                }}
              >+ Add condition</Button>
            </div>
          </div>
          <FieldGroup label="Default branch (node ID)" htmlFor="step-default">
            <Input id="step-default" placeholder="node-id" value={config.default_branch}
              onChange={(e) => onUpdate({ ...config, default_branch: e.target.value })} />
          </FieldGroup>
        </>
      )}

      {/* ── Delay ── */}
      {config.logic_type === "delay" && (
        <FieldGroup label="Delay (seconds)" htmlFor="step-delay" hint="Max 300s (5 min). Pauses execution before the next node.">
          <Input
            id="step-delay"
            type="number"
            min={0}
            max={300}
            value={config.seconds}
            onChange={(e) => onUpdate({ ...config, seconds: Math.min(300, Math.max(0, Number(e.target.value))) })}
          />
        </FieldGroup>
      )}

      {/* ── Loop ── */}
      {config.logic_type === "loop" && (
        <>
          <FieldGroup label="Iterate over" htmlFor="step-loop-over" hint="Expression that resolves to an array. e.g. input.emails">
            <Input
              id="step-loop-over"
              placeholder="input.items"
              value={config.over}
              onChange={(e) => onUpdate({ ...config, over: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Item variable name" htmlFor="step-loop-var" hint="Name used to reference the current item in downstream nodes.">
            <Input
              id="step-loop-var"
              placeholder="item"
              value={config.item_var}
              onChange={(e) => onUpdate({ ...config, item_var: e.target.value })}
            />
          </FieldGroup>
        </>
      )}

      {/* ── Format ── */}
      {config.logic_type === "format" && (
        <>
          <FieldGroup label="Template" htmlFor="step-format-tpl" hint="Python-style str.format_map. Use {field_name} to insert values.">
            <Textarea
              id="step-format-tpl"
              rows={4}
              placeholder={"Hello {name}, your order {order_id} is ready."}
              value={config.template}
              onChange={(e) => onUpdate({ ...config, template: e.target.value })}
              className="text-xs resize-y font-mono"
            />
          </FieldGroup>
          <FieldGroup label="Output key" htmlFor="step-format-key" hint="Key under which the formatted string is stored in output.">
            <Input
              id="step-format-key"
              placeholder="text"
              value={config.output_key}
              onChange={(e) => onUpdate({ ...config, output_key: e.target.value })}
            />
          </FieldGroup>
        </>
      )}

      {/* ── Parse ── */}
      {config.logic_type === "parse" && (
        <>
          <FieldGroup label="Input key" htmlFor="step-parse-key" hint="Key in upstream output that contains the raw string to parse.">
            <Input
              id="step-parse-key"
              placeholder="text"
              value={config.input_key}
              onChange={(e) => onUpdate({ ...config, input_key: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Format" htmlFor="step-parse-fmt">
            <Select
              id="step-parse-fmt"
              value={config.format}
              onChange={(e) => onUpdate({ ...config, format: e.target.value as "json" | "csv" | "lines" })}
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="lines">Lines (split by newline)</option>
            </Select>
          </FieldGroup>
          <p className="text-[11px] text-muted-foreground">Result stored as <span className="font-mono">output.parsed</span>.</p>
        </>
      )}

      {/* ── Deduplicate ── */}
      {config.logic_type === "deduplicate" && (
        <FieldGroup label="Key field" htmlFor="step-dedup-key" hint="Field used to identify duplicates in input.items array.">
          <Input
            id="step-dedup-key"
            placeholder="id"
            value={config.key}
            onChange={(e) => onUpdate({ ...config, key: e.target.value })}
          />
        </FieldGroup>
      )}

      {/* ── Sort ── */}
      {config.logic_type === "sort" && (
        <>
          <FieldGroup label="Sort by field" htmlFor="step-sort-key" hint="Field to sort by in the input.items array.">
            <Input
              id="step-sort-key"
              placeholder="created_at"
              value={config.key}
              onChange={(e) => onUpdate({ ...config, key: e.target.value })}
            />
          </FieldGroup>
          <FieldGroup label="Order" htmlFor="step-sort-order">
            <Select
              id="step-sort-order"
              value={config.order}
              onChange={(e) => onUpdate({ ...config, order: e.target.value as "asc" | "desc" })}
            >
              <option value="asc">Ascending (A → Z, 0 → 9)</option>
              <option value="desc">Descending (Z → A, 9 → 0)</option>
            </Select>
          </FieldGroup>
        </>
      )}
    </div>
  );
}

// ─── KV list editor ───────────────────────────────────────────────────────────

function KeyValueListEditor({
  label,
  items,
  onChange,
  emptyKeyPlaceholder,
  emptyValuePlaceholder,
}: {
  label: string;
  items: Array<{ key: string; value: string }>;
  onChange: (next: Array<{ key: string; value: string }>) => void;
  emptyKeyPlaceholder: string;
  emptyValuePlaceholder: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {items.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No entries yet.</p>
      )}
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={item.key}
            placeholder={emptyKeyPlaceholder}
            className="text-xs"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...next[index], key: e.target.value };
              onChange(next);
            }}
          />
          <Input
            value={item.value}
            placeholder={emptyValuePlaceholder}
            className="text-xs"
            onChange={(e) => {
              const next = [...items];
              next[index] = { ...next[index], value: e.target.value };
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => onChange([...items, { key: "", value: "" }])}
      >
        + Add entry
      </Button>
    </div>
  );
}

// ─── Connection sidebar ───────────────────────────────────────────────────────

function isHttpConnectionConfig(config: ConnectionConfig): config is HttpConnectionConfig {
  return config.connector_type === "http";
}

function ConnectionSidebar({
  config,
  nodeConnection,
  availableConnections,
  onUpdate,
}: {
  config: ConnectionConfig;
  nodeConnection: string | null;
  availableConnections: SidebarConnection[];
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const [newScope, setNewScope] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!isHttpConnectionConfig(config)) {
    const oauthConfig = config as {
      scope_access: "read" | "write" | "read_write";
      scope_required: string[];
      operation?: string;
      operation_params?: Record<string, unknown>;
    };

    // Provider resolved from selected connection, falling back to the hint
    // stored in config when the node was created from the palette.
    const selectedProvider =
      availableConnections.find((c) => c.name === nodeConnection)?.provider ??
      oauthConfig.provider ??
      "";
    const supportedOps = CONNECTOR_OPERATIONS[selectedProvider] ?? [];

    // Only show connections that match the intended provider (if known).
    const filteredConnections = oauthConfig.provider
      ? availableConnections.filter((c) => c.provider === oauthConfig.provider)
      : availableConnections;

    function handleConnectionChange(name: string) {
      const newProvider = availableConnections.find((c) => c.name === name)?.provider ?? "";
      const patch: Record<string, unknown> = { connection: name };
      if (newProvider !== selectedProvider) {
        patch.operation = undefined;
        patch.operation_params = undefined;
      }
      onUpdate(patch);
    }

    return (
      <div className="space-y-3">
        {/* Connection selector */}
        {filteredConnections.length > 0 ? (
          <FieldGroup label="Connection" htmlFor="conn-select">
            <Select
              id="conn-select"
              value={nodeConnection ?? ""}
              onChange={(e) => handleConnectionChange(e.target.value)}
            >
              <option value="">— none —</option>
              {filteredConnections.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </FieldGroup>
        ) : (
          <div className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
            {oauthConfig.provider
              ? `No ${oauthConfig.provider} account connected. Go to Connections to add one.`
              : "No connections linked to this program. Add connections on the program detail page."}
          </div>
        )}

        {/* Operation picker */}
        {supportedOps.length > 0 && (
          <FieldGroup label="Operation" htmlFor="conn-op">
            <Select
              id="conn-op"
              value={oauthConfig.operation ?? ""}
              onChange={(e) => {
                const op = e.target.value || undefined;
                const autoScopes = op
                  ? (OPERATION_SCOPES[selectedProvider]?.[op] ?? [])
                  : [];
                onUpdate({
                  operation: op,
                  operation_params: undefined,
                  ...(autoScopes.length > 0 ? { scope_required: autoScopes } : {}),
                });
              }}
            >
              <option value="">— pass token downstream —</option>
              {supportedOps.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </Select>
          </FieldGroup>
        )}

        {/* Structured operation params */}
        {oauthConfig.operation && (
          <div className="rounded-md border border-border p-3 space-y-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {oauthConfig.operation} params
            </p>
            <OperationParamsEditor
              provider={selectedProvider}
              operation={oauthConfig.operation}
              params={oauthConfig.operation_params ?? {}}
              onChange={(next) => onUpdate({ operation_params: next })}
            />
          </div>
        )}

        <FieldGroup label="Scope access" htmlFor="conn-scope">
          <Select
            id="conn-scope"
            value={oauthConfig.scope_access}
            onChange={(e) =>
              onUpdate({ scope_access: e.target.value as "read" | "write" | "read_write" })
            }
          >
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="read_write">Read + Write</option>
          </Select>
        </FieldGroup>

        <div className="space-y-2">
          <Label className="text-xs">Required scopes</Label>
          {oauthConfig.scope_required.map((scope, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="flex-1 rounded-md border border-border bg-muted px-2 py-1 text-xs">
                {scope}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => {
                  onUpdate({ scope_required: oauthConfig.scope_required.filter((_, j) => j !== i) });
                }}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                </svg>
              </Button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <Input
              placeholder="e.g. gmail.readonly"
              value={newScope}
              onChange={(e) => setNewScope(e.target.value)}
              className="text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newScope.trim()) {
                  onUpdate({ scope_required: [...oauthConfig.scope_required, newScope.trim()] });
                  setNewScope("");
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!newScope.trim()}
              onClick={() => {
                if (!newScope.trim()) return;
                onUpdate({ scope_required: [...oauthConfig.scope_required, newScope.trim()] });
                setNewScope("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── HTTP connection ──────────────────────────────────────────────────────────
  const retryConfig: RetryConfig = config.retry ?? {
    max_attempts: 3,
    backoff: "exponential",
    backoff_base_seconds: 5,
    fail_program_on_exhaust: false,
  };

  return (
    <div className="space-y-3">
      <FieldGroup label="Method" htmlFor="http-method">
        <Select
          id="http-method"
          value={config.method}
          onChange={(e) => onUpdate({ method: e.target.value as HttpConnectionConfig["method"] })}
        >
          {["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </Select>
      </FieldGroup>

      <FieldGroup label="URL" htmlFor="http-url">
        <Input
          id="http-url"
          placeholder="https://api.example.com/v1/resource"
          value={config.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
        />
      </FieldGroup>

      <FieldGroup label="Auth type" htmlFor="http-auth-type">
        <Select
          id="http-auth-type"
          value={config.auth_type}
          onChange={(e) =>
            onUpdate({
              auth_type: e.target.value as HttpConnectionConfig["auth_type"],
              auth_value: e.target.value === "none" ? null : config.auth_value,
            })
          }
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic (username:password)</option>
          <option value="api_key_header">API key (header)</option>
          <option value="api_key_query">API key (query param)</option>
        </Select>
      </FieldGroup>

      {config.auth_type !== "none" && (
        <FieldGroup label="Auth value" htmlFor="http-auth-value">
          <Input
            id="http-auth-value"
            placeholder={config.auth_type === "basic" ? "username:password" : "token-or-api-key"}
            value={config.auth_value ?? ""}
            onChange={(e) => onUpdate({ auth_value: e.target.value || null })}
          />
        </FieldGroup>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide advanced" : "Advanced options"}
      </Button>

      {showAdvanced && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <KeyValueListEditor
            label="Query params"
            items={config.query_params}
            onChange={(next) => onUpdate({ query_params: next })}
            emptyKeyPlaceholder="key"
            emptyValuePlaceholder="value"
          />
          <KeyValueListEditor
            label="Headers"
            items={config.headers}
            onChange={(next) => onUpdate({ headers: next })}
            emptyKeyPlaceholder="Header-Name"
            emptyValuePlaceholder="Header value"
          />
          <FieldGroup label="Body" htmlFor="http-body">
            <Textarea
              id="http-body"
              rows={5}
              placeholder='{"example": "value"}'
              value={config.body ?? ""}
              onChange={(e) => onUpdate({ body: e.target.value || null })}
              className="text-xs font-mono resize-none"
            />
          </FieldGroup>
          <Toggle
            id="http-parse-response"
            checked={config.parse_response}
            onChange={(v) => onUpdate({ parse_response: v })}
            label="Parse response as JSON"
          />
          <FieldGroup label="Timeout (seconds)" htmlFor="http-timeout">
            <Input
              id="http-timeout"
              type="number"
              min={1}
              placeholder="Default: 30"
              value={config.timeout_seconds ?? ""}
              onChange={(e) =>
                onUpdate({ timeout_seconds: e.target.value ? Number(e.target.value) : null })
              }
            />
          </FieldGroup>
          <Toggle
            id="http-enable-retry"
            checked={config.retry !== null}
            onChange={(enabled) => onUpdate({ retry: enabled ? retryConfig : null })}
            label="Enable retries"
          />
          {config.retry !== null && (
            <div className="space-y-3 rounded-md border border-border p-2.5">
              <FieldGroup label="Max attempts (1-5)" htmlFor="http-retry-attempts">
                <Input
                  id="http-retry-attempts"
                  type="number"
                  min={1}
                  max={5}
                  value={retryConfig.max_attempts}
                  onChange={(e) =>
                    onUpdate({ retry: { ...retryConfig, max_attempts: Math.min(5, Math.max(1, Number(e.target.value))) } })
                  }
                />
              </FieldGroup>
              <FieldGroup label="Backoff strategy" htmlFor="http-retry-backoff">
                <Select
                  id="http-retry-backoff"
                  value={retryConfig.backoff}
                  onChange={(e) =>
                    onUpdate({ retry: { ...retryConfig, backoff: e.target.value as RetryConfig["backoff"] } })
                  }
                >
                  <option value="none">None</option>
                  <option value="linear">Linear</option>
                  <option value="exponential">Exponential</option>
                </Select>
              </FieldGroup>
              {retryConfig.backoff !== "none" && (
                <FieldGroup label="Backoff base seconds" htmlFor="http-retry-base">
                  <Input
                    id="http-retry-base"
                    type="number"
                    min={0}
                    value={retryConfig.backoff_base_seconds}
                    onChange={(e) =>
                      onUpdate({ retry: { ...retryConfig, backoff_base_seconds: Number(e.target.value) } })
                    }
                  />
                </FieldGroup>
              )}
              <Toggle
                id="http-retry-fail"
                checked={retryConfig.fail_program_on_exhaust}
                onChange={(v) => onUpdate({ retry: { ...retryConfig, fail_program_on_exhaust: v } })}
                label="Fail program when retries exhausted"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Last Run Panel ───────────────────────────────────────────────────────────

const STATUS_BADGE_CLASS: Record<string, string> = {
  running:  "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  success:  "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400",
  failed:   "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  idle:     "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  pending:  "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400",
  skipped:  "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
  waiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
};

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function CollapsibleJson({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  const [expanded, setExpanded] = useState(false);
  const raw = value == null ? "null" : JSON.stringify(value, null, 2);
  const preview = raw.length > 300 ? raw.slice(0, 300) + "…" : raw;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
        >
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
      </button>
      {expanded && (
        <pre className="rounded-md bg-muted px-2.5 py-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {raw}
        </pre>
      )}
      {!expanded && (
        <pre className="rounded-md bg-muted px-2.5 py-2 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed line-clamp-4">
          {preview}
        </pre>
      )}
    </div>
  );
}

function LastRunPanel({
  execution,
  programId,
  lastRunId,
}: {
  execution: NodeExecutionData | undefined;
  programId: string;
  lastRunId: string | null | undefined;
}) {
  const [open, setOpen] = useState(true);
  const [copiedError, setCopiedError] = useState(false);

  const duration = execution
    ? formatDuration(execution.started_at, execution.completed_at)
    : null;

  return (
    <div className="border-t border-border pt-4 mt-2">
      {/* Section toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 hover:text-foreground transition-colors"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={cn("h-3 w-3 transition-transform", open && "rotate-90")}
        >
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Last run
      </button>

      {open && (
        <div className="space-y-3">
          {!execution ? (
            <p className="text-[11px] text-muted-foreground">
              No run data yet. Run the program to see execution details here.
            </p>
          ) : (
            <>
              {/* Status + duration */}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                    STATUS_BADGE_CLASS[execution.status] ?? STATUS_BADGE_CLASS["idle"]
                  )}
                >
                  {execution.status.replace(/_/g, " ")}
                </span>
                {duration && (
                  <span className="text-[11px] text-muted-foreground">{duration}</span>
                )}
              </div>

              {/* Input payload */}
              <CollapsibleJson label="Input" value={execution.input_payload} />

              {/* Output payload */}
              <CollapsibleJson label="Output" value={execution.output_payload} />

              {/* Error block */}
              {execution.error_message && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold text-destructive uppercase tracking-wide">
                      Error
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(execution.error_message ?? "");
                        setCopiedError(true);
                        setTimeout(() => setCopiedError(false), 2000);
                      }}
                      className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy error message"
                    >
                      {copiedError ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[11px] text-foreground font-mono break-all leading-relaxed">
                    {execution.error_message}
                  </p>
                </div>
              )}

              {/* View full run link */}
              {lastRunId && (
                <Link
                  href={`/programs/${programId}/runs/${lastRunId}`}
                  className="text-[11px] text-primary underline underline-offset-2 hover:opacity-80"
                >
                  View full run →
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── NodeSidebar ──────────────────────────────────────────────────────────────

export function NodeSidebar({
  nodeId,
  schema,
  programId,
  apiKeys,
  connections,
  validationResult,
  nodeExecutions,
  lastRunId,
  onUpdate,
  onClose,
  onDelete,
}: NodeSidebarProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const node = schema.nodes.find((n) => n.id === nodeId);

  const [label, setLabel] = useState(node?.label ?? "");
  const [description, setDescription] = useState(node?.description ?? "");

  useEffect(() => {
    setLabel(node?.label ?? "");
    setDescription(node?.description ?? "");
  }, [nodeId, node?.label, node?.description]);

  if (!node) return null;

  // Filter validation issues to this node only
  const nodeErrors = validationResult?.errors.filter((e) => e.node_id === nodeId) ?? [];
  const nodeWarnings = validationResult?.warnings.filter((w) => w.node_id === nodeId) ?? [];

  function commitLabel() {
    if (label !== node?.label) onUpdate(nodeId, { label });
  }

  function commitDescription() {
    if (description !== node?.description) onUpdate(nodeId, { description });
  }

  function handleConfigUpdate(patch: Record<string, unknown>) {
    onUpdate(nodeId, patch);
  }

  const NODE_TYPE_LABEL: Record<string, string> = {
    trigger: "Trigger",
    agent: "Agent",
    step: "Step",
    connection: "Connection",
  };

  return (
    <aside
      className={cn(
        "fixed top-0 right-0 bottom-0 z-30 w-80",
        "bg-background border-l border-border shadow-xl",
        "flex flex-col",
        "transition-transform duration-200"
      )}
      style={{ top: 56 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              node.type === "trigger"    && "bg-green-500/15 text-green-700 dark:text-green-400",
              node.type === "agent"      && "bg-purple-500/15 text-purple-700 dark:text-purple-400",
              node.type === "step"       && "bg-blue-500/15 text-blue-700 dark:text-blue-400",
              node.type === "connection" && "bg-slate-500/15 text-slate-700 dark:text-slate-300"
            )}
          >
            {NODE_TYPE_LABEL[node.type]}
          </span>
          <span className="text-sm font-medium text-foreground truncate max-w-[160px]">
            {node.label}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close sidebar"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Per-node validation */}
        <ValidationSummary errors={nodeErrors} warnings={nodeWarnings} />

        {/* Label & Description */}
        <SidebarSection title="Identity">
          <FieldGroup label="Label" htmlFor="node-label">
            <Input
              id="node-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => e.key === "Enter" && commitLabel()}
            />
          </FieldGroup>
          <FieldGroup label="Description" htmlFor="node-desc">
            <Textarea
              id="node-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={commitDescription}
              className="text-xs resize-none"
            />
          </FieldGroup>
        </SidebarSection>

        {/* Type-specific config */}
        <SidebarSection title="Configuration">
          {node.type === "agent" && (
            <AgentSidebar
              config={node.config as AgentConfig}
              apiKeys={apiKeys}
              onUpdate={(patch) => handleConfigUpdate(patch as Record<string, unknown>)}
            />
          )}
          {node.type === "trigger" && (
            <TriggerSidebar
              config={node.config as TriggerConfig}
              onUpdate={(patch) => handleConfigUpdate(patch as Record<string, unknown>)}
            />
          )}
          {node.type === "step" && (
            <StepSidebar
              config={node.config as StepConfig}
              onUpdate={(patch) => handleConfigUpdate(patch as Record<string, unknown>)}
            />
          )}
          {node.type === "connection" && (
            <ConnectionSidebar
              config={node.config as ConnectionConfig}
              nodeConnection={node.connection}
              availableConnections={connections}
              onUpdate={handleConfigUpdate}
            />
          )}
        </SidebarSection>

        {/* Last run inspector */}
        <LastRunPanel
          execution={nodeExecutions?.[nodeId]}
          programId={programId}
          lastRunId={lastRunId}
        />
      </div>

      {/* Footer — delete */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-colors w-full"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 4h11M5.5 4V2.5a1 1 0 011-1h3a1 1 0 011 1V4m2 0v9a1 1 0 01-1 1h-7a1 1 0 01-1-1V4h9z" />
          </svg>
          Delete node
        </button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete node?"
        description={`"${node?.label}" and all its connected edges will be removed. You can undo this.`}
        confirmLabel="Delete"
        onConfirm={() => { setDeleteOpen(false); onDelete(nodeId); }}
        onCancel={() => setDeleteOpen(false)}
      />
    </aside>
  );
}
