env        = "prod"
aws_region = "eu-west-2"

# Where mail to sales@, support@, privacy@ and legal@impulsoiq.rinegansolutions.com
# is forwarded. Every message is also kept in s3://impulsoiq-inbound-mail-prod/inbound/.
# Must not be an address on impulsoiq.rinegansolutions.com (that would loop).
contact_forward_to = ["info@rinegansolutions.com"]
