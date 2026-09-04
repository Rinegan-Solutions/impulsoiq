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

  # An empty subdomain serves the zone apex. Prod does exactly that, so the
  # public address is impulsoiq.rinegansolutions.com -- naming the apex here
  # rather than "app." is what makes the site reachable at the domain users
  # will actually type.
  fqdn = var.subdomain == "" ? var.route53_zone_name : "${var.subdomain}.${var.route53_zone_name}"

  # Extra names served by the same distribution and covered by the same
  # certificate. Kept as a list so adding another alias is a one-line change.
  alt_fqdns = var.www_alias ? ["www.${local.fqdn}"] : []

  # Tenant addresses. Every workspace is <slug>.<fqdn>, so ONE wildcard covers
  # all of them and no per-tenant DNS or certificate work is needed when a
  # workspace is created.
  #
  # Each environment's wildcard is distinct (*.impulsoiq..., *.dev.impulsoiq...,
  # *.test.impulsoiq...), which is what keeps three independent Terraform states
  # from contending over one certificate validation record — the same reason the
  # per-environment certificates exist at all.
  tenant_wildcard = var.tenant_subdomains ? ["*.${local.fqdn}"] : []

  all_fqdns = concat([local.fqdn], local.alt_fqdns, local.tenant_wildcard)
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
# One certificate per environment, covering that environment's own names:
# its FQDN, optionally www, and its own tenant wildcard.
#
# There is deliberately no SHARED wildcard across environments. A single
# *.impulsoiq.rinegansolutions.com certificate would produce one validation
# record name, and dev, test and prod run in separate Terraform states — all
# three would contend for the same Route53 record. Per-environment certificates
# give each a distinct validation record and remove the contention.
#
# The per-environment wildcards do not overlap either: *.impulsoiq... (prod),
# *.dev.impulsoiq... and *.test.impulsoiq... are three different names. Note a
# wildcard matches exactly ONE label, so *.impulsoiq... does not cover
# acme.dev.impulsoiq... — which is what keeps prod's certificate from being
# usable for a non-prod host.
resource "aws_acm_certificate" "web" {
  provider = aws.us_east_1
  # The apex is the primary name; www (when enabled) rides along as a SAN so
  # both are served by one certificate and one distribution.
  domain_name               = local.fqdn
  subject_alternative_names = concat(local.alt_fqdns, local.tenant_wildcard)
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Project = local.project, Env = var.env }
}

# ACM publishes the CNAME it wants to see; we write it into the zone.
# ACM gives a wildcard and its base domain the SAME validation record:
# *.example.com and example.com both validate through _x.example.com. Emitting
# one Route53 resource per validation option would therefore declare two
# resources writing one record.
#
# The fix is to skip the wildcard, not to re-key the map. for_each keys must be
# known at PLAN time, and resource_record_name is only known after apply — so
# keying on it fails with "keys derived from resource attributes that cannot be
# determined until apply" the moment the certificate is replaced. domain_name
# mirrors the configuration, so it stays known.
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
    if !startswith(dvo.domain_name, "*.")
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

# ── Tenant routing function ───────────────────────────────────────────────────
# The zone is injected rather than hardcoded so the same source file behaves
# correctly in every environment: in prod a tenant is <slug>.impulsoiq...,
# in dev it is <slug>.dev.impulsoiq...
resource "aws_cloudfront_function" "tenant_router" {
  count = var.tenant_subdomains ? 1 : 0

  name    = "${local.project}-tenant-router-${var.env}"
  runtime = "cloudfront-js-2.0"
  comment = "Resolves <slug>.${local.fqdn} to a tenant and rejects reserved or malformed workspace hosts"
  publish = true

  code = templatefile("${path.module}/functions/tenant-router.js", {
    zone = local.fqdn
  })
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = local.all_fqdns

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

    # Layer 1 of tenant isolation. viewer-request runs on EVERY request,
    # including cache hits, which is what makes it safe to reject unknown
    # workspaces here — a cached 200 for one host can never be served to a host
    # the function would have rejected.
    dynamic "function_association" {
      for_each = var.tenant_subdomains ? [1] : []
      content {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.tenant_router[0].arn
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
# Alias (not CNAME) so the record can sit at the ZONE APEX -- a CNAME cannot
# coexist with the apex SOA/NS records, which is precisely why the apex needs
# an alias here. One record per name in local.all_fqdns.
resource "aws_route53_record" "web" {
  for_each = toset(local.all_fqdns)

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

# IPv6. CloudFront answers on both stacks, and a browser on an IPv6-only
# network gets no answer at all without a AAAA record -- it does not fall back
# to the A record.
resource "aws_route53_record" "web_v6" {
  for_each = toset(local.all_fqdns)

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value
  type    = "AAAA"

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

# The PUBLIC address, not the CloudFront hostname. A consumer asking for
# "the web domain" wants the URL a user visits; the dXXXX.cloudfront.net name
# is an implementation detail and is still available as an output.
resource "aws_ssm_parameter" "web_domain" {
  name  = "/impulsoiq/${var.env}/web/domain"
  type  = "String"
  value = local.fqdn
  tags  = { Project = local.project, Env = var.env }
}

resource "aws_ssm_parameter" "web_url" {
  name  = "/impulsoiq/${var.env}/web/url"
  type  = "String"
  value = "https://${local.fqdn}"
  tags  = { Project = local.project, Env = var.env }
}
