terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.18" }
  }
  required_version = ">= 1.9"
}

provider "aws" { region = var.aws_region }

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1" # ACM certs for CloudFront must be in us-east-1
}

locals {
  project = "impulsoiq"
  fqdn    = "${var.subdomain}.impulsoiq.rinegansolutions.com"
}

resource "aws_s3_bucket" "web" {
  bucket        = "${local.project}-web-${var.env}"
  force_destroy = var.env != "prod"
  tags          = { Project = local.project, Env = var.env }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.project}-web-${var.env}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── DNS ───────────────────────────────────────────────────────────────────────
# The hosted zone is a bootstrap resource, created once and shared by all three
# environments — it is NOT managed here, because three independent Terraform
# states cannot each own the same zone. Terraform only reads it, so a missing
# zone fails fast at plan time with a clear error rather than half-applying.
data "aws_route53_zone" "main" {
  name         = var.route53_zone_name
  private_zone = false
}

# ── TLS ───────────────────────────────────────────────────────────────────────
# One certificate per environment, scoped to that environment's exact FQDN.
#
# Deliberately NOT a shared "*.impulsoiq.rinegansolutions.com" wildcard: a
# wildcard produces one validation record name for all three environments, so
# dev, test and prod — which run in separate states — would each try to own the
# same Route53 record. Per-environment certs give each a distinct validation
# record and remove the contention entirely.
resource "aws_acm_certificate" "web" {
  provider          = aws.us_east_1
  domain_name       = local.fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Project = local.project, Env = var.env }
}

# ACM publishes the CNAME it wants to see; we write it into the zone.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = data.aws_route53_zone.main.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

# Blocks until ACM reports ISSUED. CloudFront rejects a PENDING_VALIDATION
# certificate, so the distribution below depends on this rather than on the
# certificate resource directly.
resource "aws_acm_certificate_validation" "web" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = [local.fqdn]

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  # SPA — serve index.html for all 404s
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = { Project = local.project, Env = var.env }
}

# ── Public DNS record ─────────────────────────────────────────────────────────
# Alias (not CNAME) so the record can sit at any level and costs no extra
# lookup. Points <subdomain>.impulsoiq.rinegansolutions.com at CloudFront.
resource "aws_route53_record" "web" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFront"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn } }
    }]
  })
}

# ── SSM parameters — consumed by apps/web/buildspec.yml at deploy time ────────
# The web build reads these to know which bucket to sync to and which
# CloudFront distribution to invalidate, so no CodeBuild env var has to
# hardcode an ID that Terraform owns.

resource "aws_ssm_parameter" "web_bucket" {
  name  = "/impulsoiq/${var.env}/web/bucket"
  type  = "String"
  value = aws_s3_bucket.web.id
  tags  = { Project = local.project, Env = var.env }
}

resource "aws_ssm_parameter" "cloudfront_id" {
  name  = "/impulsoiq/${var.env}/web/cloudfront_id"
  type  = "String"
  value = aws_cloudfront_distribution.web.id
  tags  = { Project = local.project, Env = var.env }
}

resource "aws_ssm_parameter" "web_domain" {
  name  = "/impulsoiq/${var.env}/web/domain"
  type  = "String"
  value = aws_cloudfront_distribution.web.domain_name
  tags  = { Project = local.project, Env = var.env }
}
