import { describe, expect, test } from 'claude-code/testing'

import { inLocals, labelColumn, tfAddress } from '../hooks/terraform'

describe('a grep for a Terraform address', () => {
  test('from a use or from the block that declares it', () => {
    expect(tfAddress('var.region')?.address).toBe('var.region')
    expect(tfAddress('\\bvar\\.region\\b')?.address).toBe('var.region')
    expect(tfAddress('variable "region"')?.address).toBe('var.region')
    expect(tfAddress('module.vpc')?.declares).toBe('^[[:space:]]*module[[:space:]]+"vpc"')
    expect(tfAddress('local.tags')?.address).toBe('local.tags')
    expect(tfAddress('aws_s3_bucket.logs')).toEqual({ address: 'aws_s3_bucket.logs', declares: '^[[:space:]]*resource[[:space:]]+"aws_s3_bucket"[[:space:]]+"logs"', label: 'logs' })
    expect(tfAddress('resource "aws_s3_bucket" "logs"')?.address).toBe('aws_s3_bucket.logs')
    expect(tfAddress('data.aws_iam_policy_document.read')?.address).toBe('data.aws_iam_policy_document.read')
  })

  test('words, method calls and other text are no address', () => {
    expect(tfAddress('region')).toBeUndefined()
    expect(tfAddress('self.issue')).toBeUndefined()
    expect(tfAddress('var.region.name')).toBeUndefined()
    expect(tfAddress('bucket = ')).toBeUndefined()
  })

  test('where the server is asked: the quoted name, or a local in its block', () => {
    expect(labelColumn('variable "region" {', 'region')).toBe(11)
    expect(labelColumn('resource "aws_s3_bucket" "logs" {', 'logs')).toBe(27)
    expect(labelColumn('  tags = { team = "infra" }', 'tags')).toBe(3)
    const file = ['locals {', '  tags = {}', '}', 'resource "x_y" "z" {', '  tags = local.tags', '}']
    expect(inLocals(file, 2)).toBe(true)
    expect(inLocals(file, 5)).toBe(false)
  })
})

const GREP = 'main.tf:2:  bucket = "logs-${var.region}"\nproviders.tf:2:  region = var.region\nmodules/net/main.tf:3:  cidr = var.region\n'
const DECLARED = 'variables.tf:1:variable "region" {\nmodules/net/variables.tf:4:variable "region" {\nmodules/other/variables.tf:1:variable "region" {\n'

test('a grep for var.region gets the references of each module that uses it', { options: { answer: true } }, async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: GREP, stderr: '', interrupted: false }, text: GREP }))
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('grep') ? DECLARED : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const asked: string[] = []
  on('tool.call', { tool: 'LSP' }, (_$, e) => {
    const i = e as unknown as { operation: string; filePath: string; line: number; character: number }
    asked.push(`${i.operation} ${i.filePath}:${i.line}:${i.character}`)
    const text = i.filePath === '/repo/variables.tf'
      ? 'Found 2 references across 2 files:\n\nmain.tf:\n  Line 2:20\n\nproviders.tf:\n  Line 2:12\n'
      : 'Found 1 reference:\n  modules/net/main.tf:3:10\n'
    return { result: {}, text }
  })
  const r = await $.tool.call({ tool: 'Bash', command: 'grep -rn "var.region" .' })
  // The module that declares it without a use in the grep is not asked.
  expect(asked).toEqual(['findReferences /repo/variables.tf:1:11', 'findReferences /repo/modules/net/variables.tf:4:11'])
  const note = (r.context ?? []).find(n => n.startsWith('`var.region` per the language server'))
  expect(note).toContain('3 references in code, in 3 files')
  expect(note).toContain('modules/net/main.tf: 3')
})

test('a module whose server finds nothing where the grep found uses is still indexing: no note', { options: { answer: true } }, async ($, on) => {
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: GREP, stderr: '', interrupted: false }, text: GREP }))
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('grep') ? DECLARED : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'LSP' }, () => ({ result: {}, text: 'No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.' }))
  const r = await $.tool.call({ tool: 'Bash', command: 'rg -n "var\\.region"' })
  expect((r.context ?? []).some(n => n.includes('per the language server'))).toBe(false)
})
