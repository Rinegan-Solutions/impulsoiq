output "web_bucket" { value = aws_s3_bucket.web.id }
output "cloudfront_id" { value = aws_cloudfront_distribution.web.id }
output "cloudfront_domain" { value = aws_cloudfront_distribution.web.domain_name }
