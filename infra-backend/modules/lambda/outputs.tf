output "function_arns" {
  value = { for k, v in aws_lambda_function.fn : k => v.arn }
}
output "crm_write_service_arn" {
  value = aws_lambda_function.fn["crm-write-service"].arn
}
