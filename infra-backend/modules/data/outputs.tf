output "dsql_cluster_id" { value = aws_dsql_cluster.main.identifier }
# aws_dsql_cluster exposes no endpoint attribute — DSQL endpoints follow the
# documented form <identifier>.dsql.<region>.on.aws
output "dsql_cluster_endpoint" {
  value = "${aws_dsql_cluster.main.identifier}.dsql.${data.aws_region.current.region}.on.aws"
}
output "dynamodb_table_name" { value = aws_dynamodb_table.events.name }
output "dynamodb_table_arn" { value = aws_dynamodb_table.events.arn }
output "dynamodb_stream_arn" { value = aws_dynamodb_table.events.stream_arn }
output "assets_bucket" { value = aws_s3_bucket.assets.bucket }
output "vectors_bucket" { value = aws_s3_bucket.vectors.bucket }
output "event_bus_arn" { value = aws_cloudwatch_event_bus.agents.arn }
output "event_bus_name" { value = aws_cloudwatch_event_bus.agents.name }
# Phase 3
output "reporting_table_name" { value = aws_dynamodb_table.reporting.name }
output "reporting_table_arn" { value = aws_dynamodb_table.reporting.arn }
output "metering_table_name" { value = aws_dynamodb_table.metering.name }
output "metering_table_arn" { value = aws_dynamodb_table.metering.arn }
