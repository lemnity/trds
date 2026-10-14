import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { findBoundaryViolations, scanProject } from '../../tools/boundaries'

// T-011 / rules.md §2: границы модулей проверяются автоматически, а не договорённостью.
const violations = (filePath: string, code: string) =>
  findBoundaryViolations(filePath, code).map((v) => v.specifier)

describe('module boundaries', () => {
  it('lets UI use a domain module through its public entry', () => {
    expect(
      violations('src/app/(checkout)/page.tsx', "import { start } from '@/modules/checkout'"),
    ).toEqual([])
  })

  it('forbids UI deep imports into module internals', () => {
    expect(
      violations(
        'src/app/(checkout)/page.tsx',
        "import { x } from '@/modules/checkout/internal/reserve'",
      ),
    ).toEqual(['@/modules/checkout/internal/reserve'])
  })

  it('forbids UI importing the payments module directly', () => {
    expect(
      violations(
        'src/components/PriceSummary.tsx',
        "import { createPayment } from '@/modules/payments'",
      ),
    ).toEqual(['@/modules/payments'])
  })

  it('forbids UI importing the database layer, including dynamic imports', () => {
    expect(
      violations('src/app/(public)/page.tsx', "const m = await import('@/db/schema/orders')"),
    ).toEqual(['@/db/schema/orders'])
  })

  it('forbids UI bypassing boundaries with relative paths', () => {
    expect(
      violations('src/app/(public)/page.tsx', "import { pay } from '../../modules/payments/index'"),
    ).toEqual(['../../modules/payments/index'])
  })

  it('forbids domain modules depending on Next.js or React', () => {
    expect(
      violations(
        'src/modules/inventory/reserve.ts',
        "import { headers } from 'next/headers'\nimport { useState } from 'react'",
      ),
    ).toEqual(['next/headers', 'react'])
  })

  it('forbids domain modules importing from the app or components layers', () => {
    expect(
      violations(
        'src/modules/tickets/issue.ts',
        "import Page from '@/app/(public)/page'\nexport { Button } from '@/components/Button'",
      ),
    ).toEqual(['@/app/(public)/page', '@/components/Button'])
  })

  it('forbids payment provider SDKs outside payment provider adapters', () => {
    expect(
      violations(
        'src/modules/checkout/create.ts',
        "import { YooCheckout } from '@a2seven/yoo-checkout'",
      ),
    ).toEqual(['@a2seven/yoo-checkout'])
  })

  it('allows a payment provider SDK inside a provider adapter', () => {
    expect(
      violations(
        'src/modules/payments/providers/yookassa.ts',
        "import { YooCheckout } from '@a2seven/yoo-checkout'",
      ),
    ).toEqual([])
  })

  it('finds no violations in the real source tree', async () => {
    const found = await scanProject(path.resolve(import.meta.dirname, '../..'))
    expect(found).toEqual([])
  })
})
