"""GitHub native connector."""
from __future__ import annotations

import base64
from typing import Any

import httpx

from .base import IConnector, ConnectorError
from .rate_limit import request_with_rate_limit

_BASE = "https://api.github.com"
_HEADERS_BASE = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


class GitHubConnector(IConnector):
    provider = "github"
    supported_operations = [
        "create_issue",
        "comment_on_issue",
        "list_prs",
        "get_pr_diff",
        "push_file",
    ]

    async def execute(
        self,
        operation: str,
        params: dict[str, Any],
        access_token: str,
    ) -> dict[str, Any]:
        headers = {**_HEADERS_BASE, "Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            match operation:
                case "create_issue":
                    return await self._create_issue(client, headers, params)
                case "comment_on_issue":
                    return await self._comment_on_issue(client, headers, params)
                case "list_prs":
                    return await self._list_prs(client, headers, params)
                case "get_pr_diff":
                    return await self._get_pr_diff(client, headers, params)
                case "push_file":
                    return await self._push_file(client, headers, params)
                case _:
                    raise ConnectorError(
                        "UNSUPPORTED_OPERATION",
                        f"GitHub does not support operation '{operation}'",
                    )

    async def _create_issue(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        owner, repo, title = params.get("owner"), params.get("repo"), params.get("title")
        if not owner or not repo or not title:
            raise ConnectorError("MISSING_PARAM", "create_issue requires 'owner', 'repo', 'title'")
        body: dict[str, Any] = {"title": title}
        if params.get("body"):
            body["body"] = params["body"]
        if params.get("labels"):
            body["labels"] = list(params["labels"])
        if params.get("assignees"):
            body["assignees"] = list(params["assignees"])
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/repos/{owner}/{repo}/issues",
            headers=headers,
            json=body,
        )
        _raise_for_status(r, "create_issue")
        result = r.json()
        return {
            "issue_number": result.get("number"),
            "url": result.get("html_url"),
            "title": result.get("title"),
        }

    async def _comment_on_issue(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        owner = params.get("owner")
        repo = params.get("repo")
        issue_number = params.get("issue_number")
        body_text = params.get("body", "")
        if not owner or not repo or not issue_number:
            raise ConnectorError(
                "MISSING_PARAM",
                "comment_on_issue requires 'owner', 'repo', 'issue_number'",
            )
        r = await request_with_rate_limit(
            client,
            "POST",
            f"{_BASE}/repos/{owner}/{repo}/issues/{issue_number}/comments",
            headers=headers,
            json={"body": body_text},
        )
        _raise_for_status(r, "comment_on_issue")
        result = r.json()
        return {"comment_id": result.get("id"), "url": result.get("html_url")}

    async def _list_prs(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        owner, repo = params.get("owner"), params.get("repo")
        if not owner or not repo:
            raise ConnectorError("MISSING_PARAM", "list_prs requires 'owner' and 'repo'")
        state = params.get("state", "open")
        per_page = int(params.get("per_page", 30))
        r = await request_with_rate_limit(
            client,
            "GET",
            f"{_BASE}/repos/{owner}/{repo}/pulls",
            headers=headers,
            params={"state": state, "per_page": per_page},
        )
        _raise_for_status(r, "list_prs")
        prs = r.json()
        return {
            "pull_requests": [
                {
                    "number": pr["number"],
                    "title": pr["title"],
                    "state": pr["state"],
                    "url": pr["html_url"],
                    "author": pr["user"]["login"],
                    "created_at": pr["created_at"],
                }
                for pr in prs
            ]
        }

    async def _get_pr_diff(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        owner = params.get("owner")
        repo = params.get("repo")
        pr_number = params.get("pr_number")
        if not owner or not repo or not pr_number:
            raise ConnectorError(
                "MISSING_PARAM", "get_pr_diff requires 'owner', 'repo', 'pr_number'"
            )
        diff_headers = {**headers, "Accept": "application/vnd.github.diff"}
        r = await request_with_rate_limit(
            client,
            "GET",
            f"{_BASE}/repos/{owner}/{repo}/pulls/{pr_number}",
            headers=diff_headers,
        )
        _raise_for_status(r, "get_pr_diff")
        return {"diff": r.text, "pr_number": pr_number}

    async def _push_file(
        self, client: httpx.AsyncClient, headers: dict, params: dict
    ) -> dict:
        owner = params.get("owner")
        repo = params.get("repo")
        path = params.get("path")
        message = params.get("message")
        if not owner or not repo or not path or not message:
            raise ConnectorError(
                "MISSING_PARAM",
                "push_file requires 'owner', 'repo', 'path', and 'message'",
            )

        content_base64 = params.get("content_base64")
        content = params.get("content")
        if content_base64:
            encoded = str(content_base64)
        elif content is not None:
            encoded = base64.b64encode(str(content).encode("utf-8")).decode("ascii")
        else:
            raise ConnectorError(
                "MISSING_PARAM",
                "push_file requires either 'content' or 'content_base64'",
            )

        branch = params.get("branch")
        sha = params.get("sha")
        overwrite = bool(params.get("overwrite", True))

        if overwrite and not sha:
            get_params = {"ref": branch} if branch else None
            existing = await request_with_rate_limit(
                client,
                "GET",
                f"{_BASE}/repos/{owner}/{repo}/contents/{path}",
                headers=headers,
                params=get_params,
                max_attempts=3,
            )
            if existing.status_code == 200:
                sha = existing.json().get("sha")
            elif existing.status_code != 404:
                _raise_for_status(existing, "push_file.fetch_existing")

        payload: dict[str, Any] = {
            "message": str(message),
            "content": encoded,
        }
        if branch:
            payload["branch"] = str(branch)
        if sha:
            payload["sha"] = str(sha)
        if isinstance(params.get("author"), dict):
            payload["author"] = params["author"]
        if isinstance(params.get("committer"), dict):
            payload["committer"] = params["committer"]

        r = await request_with_rate_limit(
            client,
            "PUT",
            f"{_BASE}/repos/{owner}/{repo}/contents/{path}",
            headers=headers,
            json=payload,
        )
        _raise_for_status(r, "push_file")

        data = r.json()
        content_info = data.get("content", {})
        commit_info = data.get("commit", {})
        return {
            "path": content_info.get("path") or path,
            "sha": content_info.get("sha"),
            "url": content_info.get("html_url"),
            "commit_sha": commit_info.get("sha"),
            "commit_url": commit_info.get("html_url"),
            "branch": branch,
        }


def _raise_for_status(r: httpx.Response, operation: str) -> None:
    if r.status_code == 401:
        raise ConnectorError(
            "TOKEN_EXPIRED",
            f"GitHub {operation} failed: OAuth access token is invalid or expired",
        )
    if r.status_code >= 400:
        raise ConnectorError(
            "GITHUB_API_ERROR",
            f"GitHub {operation} failed ({r.status_code}): {r.text[:300]}",
        )