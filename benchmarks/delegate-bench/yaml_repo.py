"""The YAML tasks' repository: a shop's deployment configuration, ten services whose names refer to each
other across ~50 files (Kubernetes, Compose, GitHub Actions, Ansible), the broken references one task
plants, and the grading. Big enough that reading every file costs steps, which is where checking names
by tooling could pay. Graded by parsing, never by the yaml-plus server under test.

  python3 yaml_repo.py build DIR    # writes the repository and commits it
"""
import re
import subprocess
import sys
from pathlib import Path

import yaml

SERVICES = ["api", "worker", "auth", "catalog", "cart", "orders", "billing", "search", "notify", "media"]
# Compose start order beyond db and redis: who waits for whom.
WAITS = {"orders": ["cart", "catalog"], "notify": ["orders"], "billing": ["orders"], "search": ["catalog"]}
IMAGE = "ghcr.io/shop/{s}:2.3.0"


def deployment(s: str, i: int) -> str:
    volumes = ""
    mounts = ""
    if s == "api":
        mounts = "          volumeMounts:\n            - name: settings\n              mountPath: /etc/shop\n            - name: uploads\n              mountPath: /data/uploads\n"
        volumes = ("      volumes:\n        - name: settings\n          configMap:\n            name: app-config\n            items:\n"
                   "              - key: settings.toml\n                path: settings.toml\n        - name: uploads\n          persistentVolumeClaim:\n            claimName: uploads\n")
    if s == "media":
        mounts = "          volumeMounts:\n            - name: media\n              mountPath: /data/media\n"
        volumes = "      volumes:\n        - name: media\n          persistentVolumeClaim:\n            claimName: media\n"
    return f"""\
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {s}
  namespace: shop
spec:
  replicas: {1 if s == 'worker' else 2}
  selector:
    matchLabels:
      app: {s}
  template:
    metadata:
      labels:
        app: {s}
    spec:
      serviceAccountName: {s}
      containers:
        - name: {s}
          image: {IMAGE.format(s=s)}
          ports:
            - containerPort: {8080 + i}
          envFrom:
            - configMapRef:
                name: app-config
            - configMapRef:
                name: {s}-config
          env:
            - name: SERVICE_SECRET
              valueFrom:
                secretKeyRef:
                  name: {s}-secrets
                  key: token
{mounts}{volumes}"""


def generated(n: int) -> list[str]:
    """The big repository's extra services: svc-001 … svc-<n>, each a Deployment, a Service and a ConfigMap."""
    return [f"svc-{i:03d}" for i in range(1, n + 1)]


def files(extra: int = 0) -> dict[str, str]:
    out: dict[str, str] = {"README.md": "# shop infra\n\nDeployment configuration for the shop's services: Kubernetes (k8s/), Compose (compose/), CI and deploys (.github/), hosts (ansible/).\n"}
    k = "k8s/base/"
    resources = ["namespace.yaml", "configmap.yaml", "serviceaccounts.yaml", "rbac.yaml", "pvc.yaml", "ingress.yaml", "hpa.yaml"]
    out[k + "namespace.yaml"] = "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: shop\n"
    out[k + "configmap.yaml"] = ("apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app-config\n  namespace: shop\ndata:\n  LOG_LEVEL: info\n"
                                 "  CACHE_URL: redis://redis:6379/0\n  settings.toml: |\n    [server]\n    port = 8080\n")
    out[k + "serviceaccounts.yaml"] = "---\n".join(f"apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: {s}\n  namespace: shop\n" for s in SERVICES + generated(extra))
    role = lambda name, res: f"apiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: {name}\n  namespace: shop\nrules:\n  - apiGroups: [\"\"]\n    resources: [\"{res}\"]\n    verbs: [\"get\", \"list\", \"watch\"]\n"
    binding = lambda name, r, sa: (f"apiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata:\n  name: {name}\n  namespace: shop\nroleRef:\n"
                                   f"  apiGroup: rbac.authorization.k8s.io\n  kind: Role\n  name: {r}\nsubjects:\n  - kind: ServiceAccount\n    name: {sa}\n    namespace: shop\n")
    out[k + "rbac.yaml"] = "---\n".join([role("pod-reader", "pods"), role("secret-reader", "secrets"), binding("api-reader", "pod-reader", "api"),
                                         binding("orders-reader", "pod-reader", "orders"), binding("billing-secrets", "secret-reader", "billing")])
    pvc = lambda name, size: f"apiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: {name}\n  namespace: shop\nspec:\n  accessModes: [\"ReadWriteOnce\"]\n  resources:\n    requests:\n      storage: {size}\n"
    out[k + "pvc.yaml"] = "---\n".join([pvc("uploads", "5Gi"), pvc("media", "50Gi")])
    route = lambda path, svc: f"          - path: {path}\n            pathType: Prefix\n            backend:\n              service:\n                name: {svc}\n                port:\n                  number: 80\n"
    out[k + "ingress.yaml"] = ("apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: shop\n  namespace: shop\nspec:\n  rules:\n    - host: shop.example.com\n      http:\n        paths:\n"
                               + "".join(route(p, s) for p, s in [("/", "api"), ("/catalog", "catalog"), ("/search", "search"), ("/media", "media")]))
    hpa = lambda s: (f"apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: {s}\n  namespace: shop\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n"
                     f"    kind: Deployment\n    name: {s}\n  minReplicas: 2\n  maxReplicas: 8\n  metrics:\n    - type: Resource\n      resource:\n        name: cpu\n        target:\n          type: Utilization\n          averageUtilization: 70\n")
    out[k + "hpa.yaml"] = "---\n".join(hpa(s) for s in ["api", "search", "orders", *generated(extra)[::25]])
    for i, s in enumerate(SERVICES + generated(extra)):
        out[k + f"{s}-deployment.yaml"] = deployment(s, i)
        out[k + f"{s}-config.yaml"] = f"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {s}-config\n  namespace: shop\ndata:\n  SERVICE_NAME: {s}\n  PORT: \"{8080 + i}\"\n"
        resources += [f"{s}-deployment.yaml", f"{s}-config.yaml"]
        if s != "worker":
            out[k + f"{s}-service.yaml"] = f"apiVersion: v1\nkind: Service\nmetadata:\n  name: {s}\n  namespace: shop\nspec:\n  selector:\n    app: {s}\n  ports:\n    - port: 80\n      targetPort: {8080 + i}\n"
            resources.append(f"{s}-service.yaml")
    out[k + "kustomization.yaml"] = "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: shop\nresources:\n" + "".join(f"  - {r}\n" for r in resources)

    compose = ["services:"]
    for s in SERVICES:
        deps = ["db", "redis", *WAITS.get(s, [])]
        nets = ["backend", "frontend"] if s in ("api", "media") else ["backend"]
        block = (f"  {s}:\n    image: {IMAGE.format(s=s)}\n    depends_on:\n" + "".join(f"      - {d}\n" for d in deps)
                 + "    networks:\n" + "".join(f"      - {n}\n" for n in nets)
                 + ("    volumes:\n      - uploads:/data/uploads\n" if s == "api" else "")
                 + ("    volumes:\n      - media:/data/media\n" if s == "media" else "")
                 + ("    ports:\n      - \"8080:8080\"\n" if s == "api" else ""))
        compose.append(block.rstrip("\n"))
    compose.append("  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: example\n    volumes:\n      - dbdata:/var/lib/postgresql/data\n    networks:\n      - backend")
    compose.append("  redis:\n    image: redis:7\n    networks:\n      - backend")
    out["compose/docker-compose.yml"] = "\n".join(compose) + "\n\nnetworks:\n  backend: {}\n  frontend: {}\n\nvolumes:\n  uploads: {}\n  media: {}\n  dbdata: {}\n"

    out[".github/workflows/ci.yml"] = """\
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make lint

  build:
    runs-on: ubuntu-latest
    outputs:
      image: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4
      - id: meta
        name: Image name
        run: echo "tags=ghcr.io/shop/api:${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
      - name: Build
        run: docker build -t "${{ steps.meta.outputs.tags }}" .

  test:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - run: make test

  integration:
    runs-on: ubuntu-latest
    needs: [build, test]
    steps:
      - uses: actions/checkout@v4
      - run: make integration IMAGE="${{ needs.build.outputs.image }}"

  publish:
    runs-on: ubuntu-latest
    needs: [build, test, integration, lint]
    if: github.ref == 'refs/heads/main'
    steps:
      - run: docker push "${{ needs.build.outputs.image }}"
"""
    out[".github/workflows/deploy.yml"] = """\
name: deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Where to deploy
        required: true
        default: staging

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      revision: ${{ steps.rev.outputs.sha }}
    steps:
      - uses: actions/checkout@v4
      - id: rev
        run: echo "sha=$(git rev-parse --short HEAD)" >> "$GITHUB_OUTPUT"

  deploy-staging:
    runs-on: ubuntu-latest
    needs: plan
    steps:
      - run: ./deploy.sh staging "${{ needs.plan.outputs.revision }}"

  smoke:
    runs-on: ubuntu-latest
    needs: deploy-staging
    steps:
      - id: probe
        run: echo "status=$(curl -fs https://staging.shop.example.com/health)" >> "$GITHUB_OUTPUT"
      - run: test "${{ steps.probe.outputs.status }}" = ok

  deploy-prod:
    runs-on: ubuntu-latest
    needs: [deploy-staging, smoke]
    if: inputs.environment == 'production'
    steps:
      - run: ./deploy.sh production "${{ needs.plan.outputs.revision }}"
"""
    out["ansible/site.yml"] = """\
- name: Web servers
  hosts: web
  become: true
  roles:
    - nginx
    - app
    - monitoring

- name: Database servers
  hosts: db
  become: true
  roles:
    - postgres
    - backup
    - monitoring

- name: Cache servers
  hosts: cache
  become: true
  roles:
    - redis
    - monitoring
"""
    task = lambda name, module, args, notify=None: (f"- name: {name}\n  {module}:\n" + "".join(f"    {a}\n" for a in args) + (f"  notify: {notify}\n" if notify else ""))
    handler = lambda name, module, svc: f"- name: {name}\n  {module}:\n    name: {svc}\n    state: restarted\n"
    roles = {
        "nginx": ([task("Install nginx", "ansible.builtin.package", ["name: nginx", "state: present"]),
                   task("Site configuration", "ansible.builtin.template", ["src: site.conf.j2", "dest: /etc/nginx/conf.d/shop.conf"], "restart nginx")],
                  handler("restart nginx", "ansible.builtin.service", "nginx")),
        "app": ([task("App directory", "ansible.builtin.file", ["path: /opt/shop", "state: directory"]),
                 "- name: Deploy the release\n  ansible.builtin.include_tasks: deploy.yml\n"],
                handler("restart app", "ansible.builtin.systemd", "shop")),
        "postgres": ([task("Install postgres", "ansible.builtin.package", ["name: postgresql", "state: present"]),
                      task("Tune postgres", "ansible.builtin.template", ["src: postgresql.conf.j2", "dest: /etc/postgresql/16/main/postgresql.conf"], "restart postgresql")],
                     handler("restart postgresql", "ansible.builtin.service", "postgresql")),
        "redis": ([task("Install redis", "ansible.builtin.package", ["name: redis", "state: present"]),
                   task("Redis configuration", "ansible.builtin.template", ["src: redis.conf.j2", "dest: /etc/redis/redis.conf"], "restart redis")],
                  handler("restart redis", "ansible.builtin.service", "redis")),
        "monitoring": ([task("Install node_exporter", "ansible.builtin.package", ["name: prometheus-node-exporter", "state: present"]),
                        task("Exporter flags", "ansible.builtin.template", ["src: node_exporter.default.j2", "dest: /etc/default/prometheus-node-exporter"], "restart node_exporter")],
                       handler("restart node_exporter", "ansible.builtin.service", "prometheus-node-exporter")),
        "backup": (["- name: Backup schedule\n  ansible.builtin.include_tasks: schedule.yml\n"], None),
    }
    for r, (tasks, h) in roles.items():
        out[f"ansible/roles/{r}/tasks/main.yml"] = "\n".join(tasks)
        if h:
            out[f"ansible/roles/{r}/handlers/main.yml"] = h
    out["ansible/roles/app/tasks/deploy.yml"] = task("Unpack the release", "ansible.builtin.unarchive", ["src: shop.tar.gz", "dest: /opt/shop"], "restart app")
    out["ansible/roles/backup/tasks/schedule.yml"] = task("Nightly dump", "ansible.builtin.cron", ["name: pg_dump", "hour: \"3\"", "job: /usr/local/bin/backup.sh"])
    for r, t in [("nginx", "site.conf.j2"), ("postgres", "postgresql.conf.j2"), ("redis", "redis.conf.j2"), ("monitoring", "node_exporter.default.j2")]:
        out[f"ansible/roles/{r}/templates/{t}"] = "# managed by ansible\n"
    return out


# y2: broken references, each a typo of a name that exists, one in each kind of file and two more in Kubernetes;
# (file, the text as built, the text as planted) with enough context to be unique.
PLANTED = [
    ("k8s/base/worker-deployment.yaml", "            - configMapRef:\n                name: app-config\n", "            - configMapRef:\n                name: app-confg\n"),
    ("k8s/base/hpa.yaml", "    kind: Deployment\n    name: search\n", "    kind: Deployment\n    name: serach\n"),
    ("k8s/base/ingress.yaml", "          - path: /catalog\n            pathType: Prefix\n            backend:\n              service:\n                name: catalog\n",
     "          - path: /catalog\n            pathType: Prefix\n            backend:\n              service:\n                name: catalogue\n"),
    ("compose/docker-compose.yml", "      - redis\n      - orders\n    networks:\n      - backend\n  media:", "      - redis\n      - ordres\n    networks:\n      - backend\n  media:"),
    (".github/workflows/ci.yml", "    needs: [build, test, integration, lint]\n", "    needs: [build, test, integraton, lint]\n"),
    ("ansible/roles/monitoring/tasks/main.yml", "  notify: restart node_exporter\n", "  notify: restart node-exporter\n"),
]


# yb: the big repository (300 generated services, ~1,000 YAML files) keeps y2's six and hides four more among the generated
# services: a ConfigMap and a ServiceAccount misspelled, a Service whose selector matches no pods, an autoscaler aimed at a
# misspelled Deployment.
BIG = 300
PLANTED_BIG = PLANTED + [
    ("k8s/base/svc-137-deployment.yaml", "                name: svc-137-config\n", "                name: svc-137-confg\n"),
    ("k8s/base/svc-290-deployment.yaml", "      serviceAccountName: svc-290\n", "      serviceAccountName: svc-29O\n"),
    ("k8s/base/svc-064-service.yaml", "  selector:\n    app: svc-064\n", "  selector:\n    app: svc-046x\n"),
    ("k8s/base/hpa.yaml", "    kind: Deployment\n    name: svc-226\n", "    kind: Deployment\n    name: svc-262x\n"),
]


def build(repo: Path, extra: int = 0):
    for rel, text in files(extra).items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-q", "-m", "shop infra"], cwd=repo, check=True)


def plant(repo: Path, planted: list = PLANTED):
    """The task's broken references, committed, so the task's diff is only the fixes."""
    for rel, old, new in planted:
        p = repo / rel
        text = p.read_text()
        assert text.count(old) == 1, rel
        p.write_text(text.replace(old, new))
    subprocess.run(["git", "-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-q", "-am", "planted"], cwd=repo, check=True)


def docs(repo: Path, rel: str) -> list:
    try:
        return [d for d in yaml.safe_load_all((repo / rel).read_text()) if d is not None]
    except Exception:
        return []


def all_parse(repo: Path) -> bool:
    for p in list(repo.rglob("*.yaml")) + list(repo.rglob("*.yml")):
        if ".git" in p.parts:
            continue
        try:
            list(yaml.safe_load_all(p.read_text()))
        except Exception:
            return False
    return True


def changed_files(repo: Path) -> list[str]:
    out = subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True).stdout
    return sorted(line[3:] for line in out.splitlines())


def config_map_refs(repo: Path) -> list[str]:
    """Every name a pod spec uses as a ConfigMap, in the Kubernetes manifests."""
    names = []
    for p in sorted((repo / "k8s").rglob("*.yaml")):
        for d in docs(repo, str(p.relative_to(repo))):
            if not isinstance(d, dict):
                continue
            spec = ((d.get("spec") or {}).get("template") or {}).get("spec") or {}
            for c in spec.get("containers") or []:
                names += [e["configMapRef"]["name"] for e in c.get("envFrom") or [] if "configMapRef" in e]
            names += [v["configMap"]["name"] for v in spec.get("volumes") or [] if "configMap" in v]
    return names


def kinds(repo: Path) -> dict[str, set[str]]:
    """The Kubernetes objects declared: kind → names."""
    out: dict[str, set[str]] = {}
    for p in (repo / "k8s").rglob("*.yaml"):
        for d in docs(repo, str(p.relative_to(repo))):
            if isinstance(d, dict) and "kind" in d and "metadata" in d:
                out.setdefault(d["kind"], set()).add(d["metadata"].get("name"))
    return out


def grade(task: str, answer: str, repo: Path) -> dict:
    if task == "y1-rename":
        cms = kinds(repo).get("ConfigMap", set())
        refs = config_map_refs(repo)
        left = subprocess.run(["grep", "-rlI", "--exclude-dir=.git", "app-config", "."], cwd=repo, capture_output=True, text=True).stdout.split()
        own = sorted(r for r in refs if r != "shop-config")
        ok = ("shop-config" in cms and "app-config" not in cms and refs.count("shop-config") == 11 and own == sorted(f"{s}-config" for s in SERVICES)
              and not left and all_parse(repo))
        return {"score": 1.0 if ok else 0.0, "shared_refs": refs.count("shop-config"), "old_left": left, "changed": len(changed_files(repo))}
    if task in ("y2-planted", "yb-planted"):
        planted = PLANTED_BIG if task == "yb-planted" else PLANTED
        fixed = [(rel, new) for rel, old, new in planted if old in (t := (repo / rel).read_text()) and new not in t]
        # Nothing renamed or deleted to make a reference fit: the targets are as they were.
        compose = (docs(repo, "compose/docker-compose.yml") or [{}])[0]
        ci = (docs(repo, ".github/workflows/ci.yml") or [{}])[0]
        handlers = (docs(repo, "ansible/roles/monitoring/handlers/main.yml") or [[]])[0]
        k = kinds(repo)
        targets_kept = ("app-config" in k.get("ConfigMap", set()) and "search" in k.get("Deployment", set()) and "catalog" in k.get("Service", set())
                        and "orders" in compose.get("services", {}) and "integration" in (ci.get("jobs") or {})
                        and [h.get("name") for h in handlers] == ["restart node_exporter"])
        stray = [f for f in changed_files(repo) if f not in {rel for rel, _, _ in planted}]
        score = len(fixed) / len(planted) if targets_kept and all_parse(repo) else 0.0
        return {"score": score, "fixed": len(fixed), "of": len(planted), "missed": [new.strip() for rel, _, new in planted if (rel, new) not in fixed], "targets_kept": targets_kept, "stray_changes": stray}
    if task == "y3-impact":
        expected = {"deployment/orders", "rolebinding/orders-reader"}
        declared = {f"{kind.lower()}/{n}" for kind, names in kinds(repo).items() for n in names}
        named = {f"{kind.lower()}/{name}" for kind, name in re.findall(r"\b([A-Za-z]+)\s*/\s*([a-z0-9][a-z0-9-]*)", answer)} & declared
        named.discard("serviceaccount/orders")
        tp = len(named & expected)
        prec = tp / len(named) if named else 0.0
        rec = tp / len(expected)
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        return {"score": f1, "named": sorted(named)}
    if task == "y4-compose":
        services = ((docs(repo, "compose/docker-compose.yml") or [{}])[0].get("services") or {})
        m = services.get("migrate") or {}
        keys = lambda v: set(v) if isinstance(v, list) else set((v or {}).keys())
        command = m.get("command")
        command = " ".join(command) if isinstance(command, list) else str(command or "")
        checks = {
            "migrate": bool(m),
            "image": m.get("image") == (services.get("api") or {}).get("image"),
            "command": "./manage migrate" in command,
            "after_db": "db" in keys(m.get("depends_on")),
            "backend": "backend" in keys(m.get("networks")),
            "api_after_migrate": {"migrate", "db", "redis"} <= keys((services.get("api") or {}).get("depends_on")),
            "others_kept": all(keys((services.get(s) or {}).get("depends_on")) == {"db", "redis", *WAITS.get(s, [])} for s in SERVICES if s != "api"),
            "parses": all_parse(repo),
        }
        return {"score": sum(checks.values()) / len(checks), **checks}
    raise KeyError(task)


TASKS = {
    "y1-rename": {
        "kind": "edit",
        "prompt": "In this repository, rename the shared ConfigMap `app-config` to `shop-config` everywhere it is declared or referenced. Change nothing else.",
    },
    "y2-planted": {
        "kind": "edit",
        "plant": True,
        "prompt": "Some references in this repository's deployment configuration (Kubernetes, Compose, GitHub Actions, Ansible) point to things that "
        "do not exist. Find every broken reference and fix it so it points to what was meant. Do not rename or delete the things they point to.",
    },
    "yb-planted": {
        "kind": "edit",
        "plant": True,
        "big": True,
        "prompt": "Some references in this repository's deployment configuration (Kubernetes, Compose, GitHub Actions, Ansible) point to things that "
        "do not exist. Find every broken reference and fix it so it points to what was meant. Do not rename or delete the things they point to.",
    },
    "y3-impact": {
        "kind": "explore",
        "prompt": "In this repository: which Kubernetes objects refer to the ServiceAccount `orders` by name? List each as Kind/name, one per line, "
        "and nothing else after the list.",
    },
    "y4-compose": {
        "kind": "edit",
        "prompt": "In this repository's Compose file, add a service `migrate` that uses the same image as `api`, runs `./manage migrate`, starts after "
        "`db` and is on the `backend` network; and make `api` start only after `migrate` too (keeping what it already waits for).",
    },
}


if __name__ == "__main__":
    if sys.argv[1:2] == ["build"]:
        build(Path(sys.argv[2]))
