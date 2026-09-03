output "connect_instance_id" { value = aws_connect_instance.main.id }
output "connect_instance_arn" { value = aws_connect_instance.main.arn }
output "general_queue_id" { value = aws_connect_queue.general.queue_id }
output "billing_queue_id" { value = aws_connect_queue.billing.queue_id }
output "escalations_queue_id" { value = aws_connect_queue.escalations.queue_id }
