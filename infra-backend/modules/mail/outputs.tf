output "contact_addresses" { value = local.recipients }
output "inbound_bucket" { value = aws_s3_bucket.inbound.bucket }
output "forwarding_enabled" { value = local.forwarding }
