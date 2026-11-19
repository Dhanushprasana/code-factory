export const mockNotifications = [
  {
    id: "notif-1",
    title: "Evaluation #eval-101 Complete",
    message: "4 agents evaluated on ShopSphere. Antigravity achieved highest score: 94.2.",
    timestamp: "2026-11-19T13:58:30Z",
    read: false,
    type: "success",
    link: "/results/eval-101"
  },
  {
    id: "notif-2",
    title: "Repository Analysis Succeeded",
    message: "ShopSphere monorepo analyzed: 8 APIs and 4 models detected.",
    timestamp: "2026-11-19T13:40:00Z",
    read: false,
    type: "info",
    link: "/repositories/repo-1"
  },
  {
    id: "notif-3",
    title: "Benchmark Validation Warning",
    message: "Benchmark 'Inventory Reservation Under Concurrency' produced 1 concurrency warning.",
    timestamp: "2026-11-18T16:30:00Z",
    read: true,
    type: "warning",
    link: "/benchmarks/bench-4"
  },
  {
    id: "notif-4",
    title: "Benchmark Ready",
    message: "Benchmark 'Optimistic Kanban Card Reordering' published to version v1.0.0.",
    timestamp: "2026-11-17T11:45:00Z",
    read: true,
    type: "info",
    link: "/benchmarks/bench-5"
  },
  {
    id: "notif-5",
    title: "Run #110 Failed",
    message: "Custom Enterprise Agent timed out on hidden test suite execution.",
    timestamp: "2026-11-15T10:25:00Z",
    read: true,
    type: "error",
    link: "/runs/run-110"
  }
];
