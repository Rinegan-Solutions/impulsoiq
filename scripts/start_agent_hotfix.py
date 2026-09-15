"""Zip agent sources, upload to the pipeline artifact bucket, start ARM CodeBuild."""
from __future__ import annotations

import json
import os
import zipfile

import boto3

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
AGENTCORE = os.path.join(ROOT, "infra-backend", "modules", "agentcore")
ZIP_PATH = os.path.join(ROOT, ".hotfix-agentcore.zip")
BUCKET = "impulsoiq-backend-pipeline-pipelineartifactsbucket-lh2o8q93j22d"
KEY = "hotfix/agentcore-src.zip"
REGION = "eu-west-2"

BUILD_SPEC = """
version: 0.2
phases:
  pre_build:
    commands:
      - echo "hotfix agents ENV=${ENV}"
      - ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
      - AWS_REGION=${AWS_DEFAULT_REGION:-eu-west-2}
      - ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
      - aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
  build:
    commands:
      - cd "$CODEBUILD_SRC_DIR/infra-backend/modules/agentcore"
      - |
        set -e
        for AGENT in research-enrichment ambient-interface; do
          REPO="impulsoiq-agent-${AGENT}-${ENV}"
          IMAGE="${ECR_REGISTRY}/${REPO}:hotfix"
          LATEST="${ECR_REGISTRY}/${REPO}:latest"
          echo "building ${AGENT} -> ${IMAGE}"
          docker build --platform linux/arm64 -f runtime/Dockerfile --build-arg "AGENT_NAME=${AGENT}" -t "$IMAGE" -t "$LATEST" .
          docker push "$IMAGE"
          docker push "$LATEST"
        done
  post_build:
    commands:
      - python3 "$CODEBUILD_SRC_DIR/infra-backend/modules/agentcore/roll_hotfix.py"
"""


def make_zip() -> None:
    skip_dirs = {".venv", "__pycache__", ".git"}
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, dirs, files in os.walk(AGENTCORE):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for name in files:
                if name.endswith(".pyc"):
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                zf.write(full, rel)
    print("zip bytes", os.path.getsize(ZIP_PATH), "files", len(zipfile.ZipFile(ZIP_PATH).namelist()))


def main() -> None:
    make_zip()
    s3 = boto3.client("s3", region_name=REGION)
    loc = s3.get_bucket_location(Bucket=BUCKET).get("LocationConstraint") or "us-east-1"
    print("bucket region", loc)
    s3.upload_file(ZIP_PATH, BUCKET, KEY)
    print(f"uploaded s3://{BUCKET}/{KEY}")
    cb = boto3.client("codebuild", region_name=REGION)
    resp = cb.start_build(
        projectName="impulsoiq-backend-pipeline-agent-images-prod",
        sourceTypeOverride="S3",
        sourceLocationOverride=f"{BUCKET}/{KEY}",
        artifactsOverride={"type": "NO_ARTIFACTS"},
        buildspecOverride=BUILD_SPEC,
    )
    build = resp["build"]
    print("started", build["id"], build["buildStatus"])
    print(json.dumps({"id": build["id"], "number": build.get("buildNumber")}))


if __name__ == "__main__":
    main()
