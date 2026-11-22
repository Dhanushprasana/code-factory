# User Orders Data Pipeline Challenge

The target file `/workspace/process_orders.py` already exists in your workspace.
You must immediately edit `/workspace/process_orders.py` with the complete working implementation. Do NOT ask for more files or confirmation.

---

## 1. Goal
Read the CSV file at `/workspace/raw_orders.csv` and write the JSON file to `/workspace/report.json`.

## 2. Input Data (`/workspace/raw_orders.csv`)
Columns: `order_id,user_id,amount,status,timestamp`

Rules to handle dirty data:
- Filter only rows where `status` case-insensitively equals `'COMPLETED'` (e.g. `completed`, `COMPLETED`, `Completed`).
- Ignore rows with empty or non-positive amounts (e.g. `<= 0` or missing).
- Deduplicate by `order_id` (keep only the first occurrence).

## 3. Output Schema (`/workspace/report.json`)
The output JSON must contain:
1. `total_revenue`: The sum of all valid completed order amounts rounded to 2 decimal places (float).
2. `completed_order_count`: Integer count of valid completed orders.
3. `top_users`: An object mapping `user_id` to their total spent on completed orders (rounded to 2 decimal places), sorted descending by spending.

Expected output values for this dataset:
- `total_revenue`: `349.50`
- `completed_order_count`: `4`
- `top_users`: `{"usr_102": 210.00, "usr_101": 139.50}`

## 4. Requirement
Output the entire python script content to `/workspace/process_orders.py` now.
