// Terraform names what it declares by address: var.region, local.tags, module.vpc,
// aws_s3_bucket.logs, data.aws_iam_policy_document.read. A grep for an address, or for the
// block that declares it, gets terraform-ls's references. A block is seen only within its
// module, the directory it is in, so the server is asked at each declaration in a directory
// where the grep found the address.

export type TfSearch = {
  /** The address as the configuration writes it. */
  address: string
  /** The declaring line, as an extended regular expression for git grep. */
  declares: string
  /** The name in the declaring line the server is asked about. */
  label: string
}

const ID = '[A-Za-z_][A-Za-z0-9_-]*'

/** The address a grep's pattern names, from a use (`var.region`) or its declaration (`variable "region"`). */
export function tfAddress(pattern: string): TfSearch | undefined {
  const p = pattern
    .replace(/\\b|\\<|\\>/g, '')
    .replace(/\\([."])/g, '$1')
    .replace(/^\^\s*/, '')
    .trim()
  const block = (kind: string, ...labels: string[]) => `^[[:space:]]*${kind}[[:space:]]+${labels.map(l => `"${l}"`).join('[[:space:]]+')}`
  let m: RegExpExecArray | null
  if ((m = new RegExp(`^var\\.(${ID})$`).exec(p)) || (m = new RegExp(`^variable\\s+"(${ID})"`).exec(p))) {
    const name = m[1] as string
    return { address: `var.${name}`, declares: block('variable', name), label: name }
  }
  if ((m = new RegExp(`^module\\.(${ID})$`).exec(p)) || (m = new RegExp(`^module\\s+"(${ID})"`).exec(p))) {
    const name = m[1] as string
    return { address: `module.${name}`, declares: block('module', name), label: name }
  }
  if ((m = new RegExp(`^local\\.(${ID})$`).exec(p))) {
    const name = m[1] as string
    return { address: `local.${name}`, declares: `^[[:space:]]*${name}[[:space:]]*=`, label: name }
  }
  if ((m = new RegExp(`^data\\.(${ID})\\.(${ID})$`).exec(p)) || (m = new RegExp(`^data\\s+"(${ID})"\\s+"(${ID})"`).exec(p))) {
    const [type, name] = [m[1] as string, m[2] as string]
    return { address: `data.${type}.${name}`, declares: block('data', type, name), label: name }
  }
  // A resource type is the provider's name, an underscore and the kind: aws_s3_bucket.
  if ((m = new RegExp(`^([a-z][a-z0-9]*_[A-Za-z0-9_]+)\\.(${ID})$`).exec(p)) || (m = new RegExp(`^resource\\s+"(${ID})"\\s+"(${ID})"`).exec(p))) {
    const [type, name] = [m[1] as string, m[2] as string]
    return { address: `${type}.${name}`, declares: block('resource', type, name), label: name }
  }
  return undefined
}

export const TF_FILES = /\.tf$/

/** The directory a repository path is in ('' at the root). */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** Whether a line of a .tf file sits in a `locals` block: the block it is in starts at the last unindented line above. */
export function inLocals(lines: readonly string[], line: number): boolean {
  for (let i = line - 2; i >= 0; i--) {
    const row = lines[i] as string
    if (/^\S/.test(row)) return /^locals\s*\{/.test(row)
  }
  return false
}

/** The 1-based column of the declaration's label in its line: the quoted name, or a local's name. */
export function labelColumn(text: string, label: string): number | undefined {
  const quoted = text.lastIndexOf(`"${label}"`)
  if (quoted >= 0) return quoted + 2
  const bare = new RegExp(`^\\s*${label}\\s*=`).exec(text)
  return bare ? text.indexOf(label) + 1 : undefined
}
