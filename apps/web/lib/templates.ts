// Pre-built program templates that users can load instantly without Genesis.
// Each template.schema is a valid ProgramSchema-compatible object that passes
// ProgramSchemaZ.safeParse() — validated against packages/schema/src/types.ts.

export type Template = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  schema: Record<string, unknown>;
};

const NOW = "2026-01-01T00:00:00Z";

export const TEMPLATES: Template[] = [
  // ────────────────────────────────────────────────────────────────────────
  // Template 1: Gmail → AI Summary → Slack
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "gmail-summary-slack",
    name: "Gmail → AI Summary → Slack",
    description: "Every morning fetch unread emails, summarize with AI, and post a digest to Slack.",
    tags: ["gmail", "slack", "ai", "daily"],
    schema: {
      version: "1.0",
      program_id: crypto.randomUUID(),
      program_name: "Gmail Morning Digest → Slack",
      created_at: NOW,
      updated_at: NOW,
      execution_mode: "autonomous",
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Every morning 8am",
          description: "Fires every weekday at 8am UTC.",
          connection: null,
          config: { trigger_type: "cron", expression: "0 8 * * 1-5", timezone: "UTC" },
          position: { x: 100, y: 200 },
          status: "idle",
        },
        {
          id: "gmail-1",
          type: "connection",
          label: "Fetch unread emails",
          description: "Lists unread emails from Gmail inbox.",
          connection: null,
          config: {
            scope_access: "read",
            scope_required: ["https://www.googleapis.com/auth/gmail.readonly"],
            operation: "list_emails",
            operation_params: { query: "is:unread label:inbox", max_results: 20 },
          },
          position: { x: 420, y: 200 },
          status: "idle",
        },
        {
          id: "filter-1",
          type: "step",
          label: "Skip if no emails",
          description: "Stops execution if the inbox is empty.",
          connection: null,
          config: {
            logic_type: "filter",
            condition: "len(data.get('emails', [])) > 0",
            pass_schema: null,
          },
          position: { x: 740, y: 200 },
          status: "idle",
        },
        {
          id: "loop-1",
          type: "step",
          label: "Loop over emails",
          description: "Iterates over each email stub to read its content.",
          connection: null,
          config: { logic_type: "loop", over: "data['emails']", item_var: "email" },
          position: { x: 1060, y: 200 },
          status: "idle",
        },
        {
          id: "gmail-2",
          type: "connection",
          label: "Read email body",
          description: "Fetches full content of each email.",
          connection: null,
          config: {
            scope_access: "read",
            scope_required: ["https://www.googleapis.com/auth/gmail.readonly"],
            operation: "read_email",
            operation_params: { message_id: "{{loop-1.email.id}}", include_attachments: false },
          },
          position: { x: 1380, y: 200 },
          status: "idle",
        },
        {
          id: "agent-1",
          type: "agent",
          label: "Summarize with AI",
          description: "Produces a concise two-sentence summary of each email.",
          connection: null,
          config: {
            model: "__USER_ASSIGNED__",
            api_key_ref: "__USER_ASSIGNED__",
            system_prompt:
              'You receive an email in input. Summarize it in 2 sentences. Return JSON: {"subject": "...", "summary": "...", "action_required": true|false}',
            input_schema: null,
            output_schema: null,
            requires_approval: false,
            approval_timeout_hours: 24,
            scope_required: null,
            scope_access: "read",
            retry: { max_attempts: 3, backoff: "exponential", backoff_base_seconds: 5, fail_program_on_exhaust: false },
            tools: [],
          },
          position: { x: 1700, y: 200 },
          status: "idle",
        },
        {
          id: "slack-1",
          type: "connection",
          label: "Post to Slack",
          description: "Sends the AI summary to the configured Slack channel.",
          connection: null,
          config: {
            scope_access: "write",
            scope_required: ["chat:write"],
            operation: "send_message",
            operation_params: {
              channel: "__USER_ASSIGNED__",
              text: "*{{gmail-2.subject}}*\n{{agent-1.summary}}",
            },
          },
          position: { x: 2020, y: 200 },
          status: "idle",
        },
      ],
      edges: [
        { id: "e1", from: "trigger-1", to: "gmail-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e2", from: "gmail-1", to: "filter-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e3", from: "filter-1", to: "loop-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e4", from: "loop-1", to: "gmail-2", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e5", from: "gmail-2", to: "agent-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e6", from: "agent-1", to: "slack-1", type: "data_flow", data_mapping: null, condition: null, label: null },
      ],
      triggers: [
        { node_id: "trigger-1", type: "cron", is_active: true, last_fired: null, next_scheduled: null },
      ],
      version_history: [],
      metadata: {
        description: "Every morning fetch unread emails, summarize with AI, and post a digest to Slack.",
        genesis_model: "template",
        genesis_timestamp: NOW,
        tags: ["gmail", "slack", "ai", "daily"],
        is_active: false,
        last_run_id: null,
        last_run_status: null,
        last_run_timestamp: null,
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Template 2: Webhook → Transform → HTTP
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "webhook-transform-http",
    name: "Webhook → Transform → HTTP",
    description: "Receive a webhook, reshape the payload, then forward it to another URL.",
    tags: ["webhook", "http", "transform"],
    schema: {
      version: "1.0",
      program_id: crypto.randomUUID(),
      program_name: "Webhook Relay with Transform",
      created_at: NOW,
      updated_at: NOW,
      execution_mode: "autonomous",
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Incoming webhook",
          description: "Receives HTTP POST payloads from any source.",
          connection: null,
          config: { trigger_type: "webhook", endpoint_id: crypto.randomUUID(), method: "POST" },
          position: { x: 100, y: 200 },
          status: "idle",
        },
        {
          id: "step-1",
          type: "step",
          label: "Transform payload",
          description: "Reshapes incoming data and adds a timestamp.",
          connection: null,
          config: {
            logic_type: "transform",
            transformation: "{'processed': data.get('data', data), 'timestamp': '__NOW__', 'source': 'flowos'}",
            input_schema: null,
            output_schema: null,
          },
          position: { x: 420, y: 200 },
          status: "idle",
        },
        {
          id: "http-1",
          type: "connection",
          label: "Forward to endpoint",
          description: "POSTs the transformed payload to the destination URL.",
          connection: null,
          config: {
            connector_type: "http",
            method: "POST",
            url: "__USER_ASSIGNED__",
            auth_type: "none",
            auth_value: null,
            query_params: [],
            headers: [{ key: "Content-Type", value: "application/json" }],
            body: null,
            parse_response: true,
            timeout_seconds: 30,
            retry: null,
          },
          position: { x: 740, y: 200 },
          status: "idle",
        },
      ],
      edges: [
        { id: "e1", from: "trigger-1", to: "step-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e2", from: "step-1", to: "http-1", type: "data_flow", data_mapping: null, condition: null, label: null },
      ],
      triggers: [
        { node_id: "trigger-1", type: "webhook", is_active: true, last_fired: null, next_scheduled: null },
      ],
      version_history: [],
      metadata: {
        description: "Receive a webhook, reshape the payload, then forward it to another URL.",
        genesis_model: "template",
        genesis_timestamp: NOW,
        tags: ["webhook", "http", "transform"],
        is_active: false,
        last_run_id: null,
        last_run_status: null,
        last_run_timestamp: null,
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Template 3: GitHub New Issues → Notion Tasks
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "github-issues-notion",
    name: "GitHub Issues → Notion Tasks",
    description: "Manually triggered: fetch open GitHub issues and create a Notion task for each one.",
    tags: ["github", "notion", "manual"],
    schema: {
      version: "1.0",
      program_id: crypto.randomUUID(),
      program_name: "GitHub Issues → Notion Tasks",
      created_at: NOW,
      updated_at: NOW,
      execution_mode: "autonomous",
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Manual trigger",
          description: "Run this program on demand.",
          connection: null,
          config: { trigger_type: "manual" },
          position: { x: 100, y: 200 },
          status: "idle",
        },
        {
          id: "github-1",
          type: "connection",
          label: "List open issues",
          description: "Fetches all open issues from the configured GitHub repository.",
          connection: null,
          config: {
            scope_access: "read",
            scope_required: ["repo"],
            operation: "list_issues",
            operation_params: {
              owner: "__USER_ASSIGNED__",
              repo: "__USER_ASSIGNED__",
              state: "open",
            },
          },
          position: { x: 420, y: 200 },
          status: "idle",
        },
        {
          id: "filter-1",
          type: "step",
          label: "Skip if no issues",
          description: "Stops execution when there are no open issues.",
          connection: null,
          config: {
            logic_type: "filter",
            condition: "len(data.get('issues', [])) > 0",
            pass_schema: null,
          },
          position: { x: 740, y: 200 },
          status: "idle",
        },
        {
          id: "loop-1",
          type: "step",
          label: "Loop over issues",
          description: "Iterates over each GitHub issue.",
          connection: null,
          config: { logic_type: "loop", over: "data['issues']", item_var: "issue" },
          position: { x: 1060, y: 200 },
          status: "idle",
        },
        {
          id: "notion-1",
          type: "connection",
          label: "Create Notion task",
          description: "Creates a task entry in the configured Notion database.",
          connection: null,
          config: {
            scope_access: "write",
            scope_required: ["https://www.googleapis.com/auth/drive"],
            operation: "create_database_entry",
            operation_params: {
              database_id: "__USER_ASSIGNED__",
              _title: "{{loop-1.issue.title}}",
              _body: "{{loop-1.issue.body}}",
            },
          },
          position: { x: 1380, y: 200 },
          status: "idle",
        },
      ],
      edges: [
        { id: "e1", from: "trigger-1", to: "github-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e2", from: "github-1", to: "filter-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e3", from: "filter-1", to: "loop-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e4", from: "loop-1", to: "notion-1", type: "data_flow", data_mapping: null, condition: null, label: null },
      ],
      triggers: [
        { node_id: "trigger-1", type: "manual", is_active: true, last_fired: null, next_scheduled: null },
      ],
      version_history: [],
      metadata: {
        description: "Manually triggered: fetch open GitHub issues and create a Notion task for each one.",
        genesis_model: "template",
        genesis_timestamp: NOW,
        tags: ["github", "notion", "manual"],
        is_active: false,
        last_run_id: null,
        last_run_status: null,
        last_run_timestamp: null,
      },
    },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Template 4: Daily Gmail Digest
  // ────────────────────────────────────────────────────────────────────────
  {
    id: "daily-gmail-digest",
    name: "Daily Gmail Digest",
    description: "Each day, collect matching emails, format them into a digest, and send it to your inbox.",
    tags: ["gmail", "daily", "digest"],
    schema: {
      version: "1.0",
      program_id: crypto.randomUUID(),
      program_name: "Daily Gmail Digest",
      created_at: NOW,
      updated_at: NOW,
      execution_mode: "autonomous",
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Daily at 7am",
          description: "Fires every day at 7am UTC.",
          connection: null,
          config: { trigger_type: "cron", expression: "0 7 * * *", timezone: "UTC" },
          position: { x: 100, y: 200 },
          status: "idle",
        },
        {
          id: "gmail-1",
          type: "connection",
          label: "Search emails",
          description: "Finds emails matching the configured query.",
          connection: null,
          config: {
            scope_access: "read",
            scope_required: ["https://www.googleapis.com/auth/gmail.readonly"],
            operation: "search_emails",
            operation_params: { query: "is:unread", max_results: 10 },
          },
          position: { x: 420, y: 200 },
          status: "idle",
        },
        {
          id: "filter-1",
          type: "step",
          label: "Skip if empty",
          description: "Skips the digest if no emails were found.",
          connection: null,
          config: {
            logic_type: "filter",
            condition: "len(data.get('emails', [])) > 0",
            pass_schema: null,
          },
          position: { x: 740, y: 200 },
          status: "idle",
        },
        {
          id: "step-1",
          type: "step",
          label: "Format digest",
          description: "Formats the email list into a human-readable digest.",
          connection: null,
          config: {
            logic_type: "format",
            template: "You have {count} unread emails today.",
            output_key: "digest_text",
          },
          position: { x: 1060, y: 200 },
          status: "idle",
        },
        {
          id: "gmail-2",
          type: "connection",
          label: "Send digest email",
          description: "Sends the formatted digest to your email address.",
          connection: null,
          config: {
            scope_access: "read_write",
            scope_required: [
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/gmail.send",
            ],
            operation: "send_email",
            operation_params: {
              to: "__USER_ASSIGNED__",
              subject: "Your daily email digest",
              body: "{{step-1.digest_text}}",
            },
          },
          position: { x: 1380, y: 200 },
          status: "idle",
        },
      ],
      edges: [
        { id: "e1", from: "trigger-1", to: "gmail-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e2", from: "gmail-1", to: "filter-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e3", from: "filter-1", to: "step-1", type: "data_flow", data_mapping: null, condition: null, label: null },
        { id: "e4", from: "step-1", to: "gmail-2", type: "data_flow", data_mapping: null, condition: null, label: null },
      ],
      triggers: [
        { node_id: "trigger-1", type: "cron", is_active: true, last_fired: null, next_scheduled: null },
      ],
      version_history: [],
      metadata: {
        description: "Each day, collect matching emails, format them into a digest, and send it to your inbox.",
        genesis_model: "template",
        genesis_timestamp: NOW,
        tags: ["gmail", "daily", "digest"],
        is_active: false,
        last_run_id: null,
        last_run_status: null,
        last_run_timestamp: null,
      },
    },
  },
];
