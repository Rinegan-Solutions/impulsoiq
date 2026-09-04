bucket         = "impulsoiq-tf-state"
key            = "infra-backend/test/terraform.tfstate"
region         = "eu-west-2"
# S3 conditional writes hold the state lock (Terraform 1.10+). The old
# dynamodb_table setting is deprecated and needs a separate lock table.
use_lockfile   = true
encrypt        = true
