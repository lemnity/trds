import { Alert } from '@heroui/react'
import type { ReactNode } from 'react'

type Tone = 'warning' | 'danger' | 'info'

const STATUS = { warning: 'warning', danger: 'danger', info: 'accent' } as const

export function InlineNotice({
  tone,
  title,
  children,
}: {
  tone: Tone
  title: string
  children?: ReactNode
}) {
  return (
    <Alert status={STATUS[tone]} role={tone === 'danger' ? 'alert' : 'status'}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {children && <Alert.Description>{children}</Alert.Description>}
      </Alert.Content>
    </Alert>
  )
}
