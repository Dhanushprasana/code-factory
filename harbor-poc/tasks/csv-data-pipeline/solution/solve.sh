#!/bin/bash
set -e

cat << 'EOF' > /workspace/process_orders.py
import csv
import json

def process():
    seen_orders = set()
    completed_orders = []
    
    with open('/workspace/raw_orders.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            order_id = row['order_id'].strip()
            if order_id in seen_orders:
                continue
            seen_orders.add(order_id)
            
            status = row['status'].strip().upper()
            if status != 'COMPLETED':
                continue
                
            raw_amount = row['amount'].strip()
            if not raw_amount:
                continue
                
            try:
                amount = float(raw_amount)
                if amount <= 0:
                    continue
            except ValueError:
                continue
                
            user_id = row['user_id'].strip()
            completed_orders.append((user_id, amount))
            
    total_revenue = round(sum(amt for _, amt in completed_orders), 2)
    completed_count = len(completed_orders)
    
    user_totals = {}
    for user_id, amt in completed_orders:
        user_totals[user_id] = user_totals.get(user_id, 0.0) + amt
        
    sorted_users = dict(sorted(
        {k: round(v, 2) for k, v in user_totals.items()}.items(),
        key=lambda item: item[1],
        reverse=True
    ))
    
    report = {
        "total_revenue": total_revenue,
        "completed_order_count": completed_count,
        "top_users": sorted_users
    }
    
    with open('/workspace/report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)

if __name__ == '__main__':
    process()
EOF

python3 /workspace/process_orders.py
