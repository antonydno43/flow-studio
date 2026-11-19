/**
 * Workflow template gallery. Each template contains a valid graph definition
 * using registered node types, plus required-connection metadata so the UI
 * can show honest setup requirements.
 */
import type { WorkflowGraph } from "@/core/types";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  requiredProviders: string[]; // connection providers needed for full function
  template: WorkflowGraph;
}

function node(
  id: string, type: string, name: string, x: number, y: number,
  config: Record<string, unknown> = {}
) {
  return { id, type, name, position: { x, y }, config };
}
function edge(id: string, source: string, target: string, sourcePort = "out") {
  return { id, source, sourcePort, target };
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "webhook-to-email",
    name: "Webhook Form → Email Alert",
    description: "Receive a form submission by webhook and email it to yourself instantly.",
    category: "Webhooks",
    icon: "Webhook",
    requiredProviders: ["resend"],
    template: {
      nodes: [
        node("t1", "trigger-webhook", "Form Webhook", 0, 200),
        node("a1", "send-email", "Email Alert", 400, 200, {
          to: "you@example.com",
          subject: "New form submission",
          bodyMode: "html",
          html: "<h2>New submission</h2><pre>{{ $trigger.body }}</pre>",
        }),
      ],
      edges: [edge("e1", "t1", "a1")],
    },
  },
  {
    id: "webhook-to-supabase",
    name: "Form Submission → Save to Supabase",
    description: "Store incoming webhook data as rows in your own Supabase table.",
    category: "Webhooks",
    icon: "Database",
    requiredProviders: ["supabase"],
    template: {
      nodes: [
        node("t1", "trigger-webhook", "Webhook", 0, 200),
        node("a1", "supabase", "Insert Row", 420, 200, {
          operation: "insert",
          tableIns: "submissions",
          data: '{ "name": "{{ $trigger.body.name }}", "email": "{{ $trigger.body.email }}", "payload": {{ $trigger.body }} }',
        }),
      ],
      edges: [edge("e1", "t1", "a1")],
    },
  },
  {
    id: "scheduled-reminder",
    name: "Scheduled Daily Reminder Email",
    description: "Send yourself a reminder email every day at 9:00 AM.",
    category: "Schedules",
    icon: "Clock",
    requiredProviders: ["resend"],
    template: {
      nodes: [
        node("t1", "trigger-schedule", "Every day 9 AM", 0, 200, {
          mode: "daily", hour: 9, minute: 0, timezone: "Asia/Kolkata", enabled: true,
        }),
        node("a1", "send-email", "Reminder Email", 420, 200, {
          to: "you@example.com",
          subject: "Your daily reminder",
          bodyMode: "text",
          text: "This is your scheduled reminder, sent by Flow Studio at {{ $trigger.scheduledAt }}.",
        }),
      ],
      edges: [edge("e1", "t1", "a1")],
    },
  },
  {
    id: "api-to-email",
    name: "HTTP API → Parse JSON → Email Report",
    description: "Fetch data from an API, parse the response, and email a summary.",
    category: "APIs",
    icon: "Globe",
    requiredProviders: ["resend"],
    template: {
      nodes: [
        node("t1", "trigger-manual", "Manual Trigger", 0, 200),
        node("a1", "http-request", "Fetch API", 360, 200, {
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/users/1",
        }),
        node("a2", "json-parse", "Parse Response", 700, 200, { source: "{{ a1.data }}" }),
        node("a3", "send-email", "Email Summary", 1040, 200, {
          to: "you@example.com",
          subject: "API report: {{ a2.name }}",
          bodyMode: "text",
          text: "Fetched user: {{ a2.name }} ({{ a2.email }}) from {{ a2.company.name }}.",
        }),
      ],
      edges: [edge("e1", "t1", "a1"), edge("e2", "a1", "a2"), edge("e3", "a2", "a3")],
    },
  },
  {
    id: "api-filter-slack",
    name: "API Data → Filter → Slack Message",
    description: "Fetch a list, keep only matching items, and post them to Slack.",
    category: "APIs",
    icon: "Filter",
    requiredProviders: ["slack-webhook"],
    template: {
      nodes: [
        node("t1", "trigger-manual", "Manual Trigger", 0, 200),
        node("a1", "http-request", "Fetch Users", 360, 200, {
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/users",
        }),
        node("a2", "filter", "Filter by City", 700, 200, {
          combinator: "and",
          conditions: [
            { source: "{{ $item.address.city }}", operator: "contains", target: "Gwen" },
          ],
        }),
        node("a3", "slack-message", "Notify Slack", 1040, 200, {
          text: "Matched users: {{ a2.kept }} of {{ a2.total }} - {{ a2.data }}",
        }),
      ],
      edges: [edge("e1", "t1", "a1"), edge("e2", "a1", "a2"), edge("e3", "a2", "a3")],
    },
  },
  {
    id: "webhook-if-vip",
    name: "Webhook → IF Condition → VIP or Standard Email",
    description: "Route customers to different emails based on their order amount.",
    category: "Conditions",
    icon: "GitBranch",
    requiredProviders: ["resend"],
    template: {
      nodes: [
        node("t1", "trigger-webhook", "Order Webhook", 0, 260),
        node("c1", "if", "Amount > 1000?", 340, 260, {
          combinator: "and",
          conditions: [
            { source: "{{ $trigger.body.amount }}", operator: "gt", target: "1000" },
          ],
        }),
        node("a1", "send-email", "VIP Thank You", 680, 140, {
          to: "{{ $trigger.body.email }}",
          subject: "Welcome to our VIP program!",
          bodyMode: "text",
          text: "Hi {{ $trigger.body.name }}, thank you for your order of {{ $trigger.body.amount }}. As a VIP you get priority support.",
        }),
        node("a2", "send-email", "Standard Thank You", 680, 380, {
          to: "{{ $trigger.body.email }}",
          subject: "Thank you for your order",
          bodyMode: "text",
          text: "Hi {{ $trigger.body.name }}, thank you for your order of {{ $trigger.body.amount }}.",
        }),
      ],
      edges: [
        edge("e1", "t1", "c1"),
        edge("e2", "c1", "a1", "true"),
        edge("e3", "c1", "a2", "false"),
      ],
    },
  },
  {
    id: "scheduled-api-discord",
    name: "Scheduled API Health Check → Discord",
    description: "Ping an API on a schedule and post the status to Discord.",
    category: "Schedules",
    icon: "Activity",
    requiredProviders: ["discord-webhook"],
    template: {
      nodes: [
        node("t1", "trigger-schedule", "Every hour", 0, 200, {
          mode: "hourly", minute: 0, timezone: "Asia/Kolkata", enabled: true,
        }),
        node("a1", "http-request", "Health Check", 380, 200, {
          method: "GET",
          url: "https://httpbin.org/status/200",
          continueOnFail: true,
        }),
        node("a2", "discord-message", "Post Status", 760, 200, {
          content: "API health check at {{ $trigger.scheduledAt }}: HTTP {{ a1.status }} ({{ a1.ok }})",
        }),
      ],
      edges: [edge("e1", "t1", "a1"), edge("e2", "a1", "a2")],
    },
  },
  {
    id: "loop-batch-merge",
    name: "Batch Processing → Merge → Notification",
    description: "Process a list of items in batches, aggregate results, and send one summary.",
    category: "Loops",
    icon: "Repeat",
    requiredProviders: [],
    template: {
      nodes: [
        node("t1", "trigger-manual", "Manual Trigger", 0, 260, {
          sampleInput: '{ "orders": [ {"id":"A1","amount":150}, {"id":"A2","amount":300}, {"id":"A3","amount":75} ] }',
        }),
        node("l1", "loop-items", "Loop Over Orders", 330, 260, {
          items: "{{ $trigger.input.orders }}",
          maxIterations: 100,
        }),
        node("b1", "math", "Add Tax 18%", 640, 180, {
          mode: "expression",
          expression: '{{ $item.amount }} * 1.18',
        }),
        node("l2", "loop-end", "Collect Results", 950, 260, { mode: "collect" }),
        node("a1", "set-fields", "Build Summary", 1250, 260, {
          fields: [
            { key: "processedCount", value: "{{ length(l2) }}" },
          ],
        }),
      ],
      edges: [
        edge("e1", "t1", "l1"),
        edge("e2", "l1", "b1", "body"),
        edge("e3", "b1", "l2"),
      ],
    },
  },
  {
    id: "csv-cleanup",
    name: "CSV Data Cleanup",
    description: "Parse CSV text, remove duplicate rows, and output clean JSON.",
    category: "Data",
    icon: "FileSpreadsheet",
    requiredProviders: [],
    template: {
      nodes: [
        node("t1", "trigger-manual", "Manual Trigger", 0, 200, {
          sampleInput: '{ "csv": "id,name\\n1,Ann\\n2,Bob\\n2,Bob\\n3,Cara" }',
        }),
        node("a1", "csv-parse", "Parse CSV", 360, 200, {
          source: "{{ $trigger.input.csv }}",
          delimiter: ",",
          hasHeaderRow: true,
        }),
        node("a2", "remove-duplicates", "Remove Duplicates", 700, 200, { key: "id" }),
        node("a3", "json-create", "Clean Output", 1040, 200, {
          fields: [{ key: "rows", value: "{{ a2.data }}" }, { key: "removed", value: "{{ a2.removed }}" }],
        }),
      ],
      edges: [edge("e1", "t1", "a1"), edge("e2", "a1", "a2"), edge("e3", "a2", "a3")],
    },
  },
  {
    id: "switch-by-region",
    name: "Switch by Region → Different Actions",
    description: "Route requests to different messages depending on a field value.",
    category: "Conditions",
    icon: "Split",
    requiredProviders: [],
    template: {
      nodes: [
        node("t1", "trigger-webhook", "Incoming Request", 0, 300),
        node("c1", "switch", "By Country", 360, 300, {
          source: "{{ $trigger.body.country }}",
          cases: [{ value: '"IN"' }, { value: '"US"' }],
          useDefault: true,
        }),
        node("a1", "set-fields", "India Branch", 720, 120, {
          fields: [{ key: "message", value: '"Namaste! Processing with India rules."' }, { key: "region", value: '"IN"' }],
        }),
        node("a2", "set-fields", "US Branch", 720, 300, {
          fields: [{ key: "message", value: '"Hello! Processing with US rules."' }, { key: "region", value: '"US"' }],
        }),
        node("a3", "set-fields", "Default Branch", 720, 480, {
          fields: [{ key: "message", value: '"Hello! Processing with default rules."' }, { key: "region", value: '"OTHER"' }],
        }),
        node("a4", "webhook-response", "Respond", 1080, 300, {
          status: 200,
          bodyType: "json",
          jsonBody: '{ "ok": true, "message": {{ a1.message || a2.message || a3.message }} }',
        }),
      ],
      edges: [
        edge("e1", "t1", "c1"),
        edge("e2", "c1", "a1", "0"),
        edge("e3", "c1", "a2", "1"),
        edge("e4", "c1", "a3", "default"),
        edge("e5", "a1", "a4"),
        edge("e6", "a2", "a4"),
        edge("e7", "a3", "a4"),
      ],
    },
  },
];
