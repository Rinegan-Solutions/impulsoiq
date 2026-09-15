"""Roll research-enrichment and ambient-interface AgentCore runtimes to the hotfix image digest."""
import boto3

REGION = "eu-west-2"
ACCOUNT = "159169122827"
AGENTS = {
    "research-enrichment": "impulsoiq_research_enrichment_prod-B11Ib37oa5",
    "ambient-interface": "impulsoiq_ambient_interface_prod-524sdK24JE",
}


def main() -> None:
    ecr = boto3.client("ecr", region_name=REGION)
    ctrl = boto3.client("bedrock-agentcore-control", region_name=REGION)
    for key, runtime_id in AGENTS.items():
        repo = f"impulsoiq-agent-{key}-prod"
        imgs = ecr.describe_images(repositoryName=repo, imageIds=[{"imageTag": "hotfix"}])
        digest = imgs["imageDetails"][0]["imageDigest"]
        uri = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{repo}@{digest}"
        current = ctrl.get_agent_runtime(agentRuntimeId=runtime_id)
        kwargs = {
            "agentRuntimeId": runtime_id,
            "roleArn": current["roleArn"],
            "agentRuntimeArtifact": {"containerConfiguration": {"containerUri": uri}},
            "networkConfiguration": current["networkConfiguration"],
            "environmentVariables": current.get("environmentVariables") or {},
        }
        if current.get("description"):
            kwargs["description"] = current["description"]
        if current.get("requestHeaderConfiguration"):
            kwargs["requestHeaderConfiguration"] = current["requestHeaderConfiguration"]
        print("updating", runtime_id, "->", uri)
        resp = ctrl.update_agent_runtime(**kwargs)
        print("status", resp.get("status"), "version", resp.get("agentRuntimeVersion"))


if __name__ == "__main__":
    main()
