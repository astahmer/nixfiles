# mistral-vibe 3.1.5 pins agent-client-protocol==0.11.0, but llm-agents still
# packages 0.10.1 for it. 0.10.1 has no `AcpMcpServer`, so `vibe acp` fails on
# import and DSH's ACP bridge cannot spawn it. The wheel is pure Python, so
# swap the dependency instead of rebuilding vibe from source.
{
  lib,
  llmAgentsPackages,
  llmNixpkgs,
}:

let
  mistralVibe = llmAgentsPackages."mistral-vibe";

  # Build with llm-agents' own nixpkgs so python and pydantic dedupe against the
  # interpreter upstream locked for mistral-vibe.
  python = llmNixpkgs.python3;

  agentClientProtocol = python.pkgs.buildPythonPackage {
    pname = "agent-client-protocol";
    version = "0.11.0";
    format = "wheel";

    src = python.pkgs.fetchPypi {
      pname = "agent_client_protocol";
      version = "0.11.0";
      format = "wheel";
      dist = "py3";
      python = "py3";
      abi = "none";
      platform = "any";
      hash = "sha256-LYVwzUkR+K+furSAj3sF8JIEp1bzRsdAns3K4/N82y8=";
    };

    dependencies = [ python.pkgs.pydantic ];

    pythonImportsCheck = [
      "acp"
      "acp.helpers"
      "acp.schema"
    ];

    meta = {
      description = "Python implementation of the Agent Client Protocol";
      homepage = "https://github.com/agentclientprotocol/python-sdk";
      license = lib.licenses.mit;
      platforms = lib.platforms.all;
    };
  };
in
mistralVibe.overrideAttrs (old: {
  propagatedBuildInputs = map (
    dependency:
    if (dependency.pname or null) == "agent-client-protocol" then agentClientProtocol else dependency
  ) old.propagatedBuildInputs;

  # Import the ACP agent module so dependency drift fails the build instead of
  # crashing `vibe acp` at launch.
  pythonImportsCheck = (old.pythonImportsCheck or [ ]) ++ [ "vibe.acp.agent" ];
})
