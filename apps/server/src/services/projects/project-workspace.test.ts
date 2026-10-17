import { afterEach, describe, expect, it } from "vitest";
import { createProjectSource, deleteProjectSource } from "@bb/db";
import {
  seedHost,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../../../test/helpers/seed.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../../test/helpers/test-app.js";
import { ApiError } from "../../errors.js";
import {
  resolveProjectCommandWorkspace,
  resolveProjectWorkspaceTarget,
} from "./project-workspace.js";

let harness: TestAppHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function createDeps() {
  harness = await createTestAppHarness();
  return harness.deps;
}

function expectApiError(
  operation: () => void,
  expected: { code: string; message: string; status: number },
): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ApiError);
  const error = caught as ApiError;
  expect(error.status).toBe(expected.status);
  expect(error.body.code).toBe(expected.code);
  expect(error.body.message).toBe(expected.message);
}

describe("project workspace resolution without an environment", () => {
  it("uses the project's default source when the server has no primary host", async () => {
    const deps = await createDeps();
    const { host: remote } = seedHostSession(deps, { name: "remote" });
    const { project } = seedProjectWithSource(deps, {
      hostId: remote.id,
      path: "/srv/checkout",
    });

    expect(
      resolveProjectCommandWorkspace(deps, { projectId: project.id }),
    ).toEqual({ hostId: remote.id, cwd: "/srv/checkout" });
    expect(
      resolveProjectWorkspaceTarget(deps, { projectId: project.id }),
    ).toEqual({ hostId: remote.id, path: "/srv/checkout" });
  });

  it("keeps the primary host when it exists but has no checkout of the project", async () => {
    const deps = await createDeps();
    const local = seedHost(deps, { name: "local" });
    seedPrimaryHost(deps, local.id);
    const { host: remote } = seedHostSession(deps, { name: "remote" });
    const { project } = seedProjectWithSource(deps, {
      hostId: remote.id,
      path: "/srv/checkout",
    });

    expect(
      resolveProjectCommandWorkspace(deps, { projectId: project.id }),
    ).toEqual({ hostId: local.id, cwd: null });
    expectApiError(
      () => resolveProjectWorkspaceTarget(deps, { projectId: project.id }),
      {
        status: 409,
        code: "invalid_request",
        message: "Project has no local-path source for the primary host",
      },
    );
  });

  it("prefers the primary host's checkout over the default source", async () => {
    const deps = await createDeps();
    const local = seedHost(deps, { name: "local" });
    seedPrimaryHost(deps, local.id);
    const { host: remote } = seedHostSession(deps, { name: "remote" });
    const { project } = seedProjectWithSource(deps, {
      hostId: remote.id,
      path: "/srv/checkout",
    });
    createProjectSource(deps.db, deps.hub, {
      projectId: project.id,
      type: "local_path",
      hostId: local.id,
      path: "/home/me/checkout",
    });

    expect(
      resolveProjectCommandWorkspace(deps, { projectId: project.id }),
    ).toEqual({ hostId: local.id, cwd: "/home/me/checkout" });
    expect(
      resolveProjectWorkspaceTarget(deps, { projectId: project.id }),
    ).toEqual({ hostId: local.id, path: "/home/me/checkout" });
  });

  it("keeps an explicit host ahead of both fallbacks", async () => {
    const deps = await createDeps();
    const local = seedHost(deps, { name: "local" });
    seedPrimaryHost(deps, local.id);
    const { host: remote } = seedHostSession(deps, { name: "remote" });
    const { project } = seedProjectWithSource(deps, {
      hostId: local.id,
      path: "/home/me/checkout",
    });
    createProjectSource(deps.db, deps.hub, {
      projectId: project.id,
      type: "local_path",
      hostId: remote.id,
      path: "/srv/checkout",
    });

    expect(
      resolveProjectCommandWorkspace(deps, {
        projectId: project.id,
        hostId: remote.id,
      }),
    ).toEqual({ hostId: remote.id, cwd: "/srv/checkout" });
  });

  it("still reports the missing primary host for a project without sources", async () => {
    const deps = await createDeps();
    const { host: remote } = seedHostSession(deps, { name: "remote" });
    const { project, source } = seedProjectWithSource(deps, {
      hostId: remote.id,
    });
    deleteProjectSource(deps.db, deps.hub, source.id);

    for (const resolve of [
      resolveProjectCommandWorkspace,
      resolveProjectWorkspaceTarget,
    ]) {
      expectApiError(() => resolve(deps, { projectId: project.id }), {
        status: 502,
        code: "host_unavailable",
        message: "Local host daemon is not initialized",
      });
    }
  });
});
