import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Box, Flex, Text } from '@radix-ui/themes'

export type ToastVariant = 'success' | 'error' | 'info'

interface ToastMessage {
  id: number
  title: string
  description?: string
  variant: ToastVariant
}

const ToastContext = createContext<
  (toast: { title: string; description?: string; variant?: ToastVariant }) => void
>(() => {})

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const notify = useCallback(
    (toast: { title: string; description?: string; variant?: ToastVariant }) => {
      const message: ToastMessage = {
        id: nextId++,
        title: toast.title,
        description: toast.description,
        variant: toast.variant ?? 'info',
      }
      setToasts((current) => [...current, message])
      const timer = setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== message.id))
      }, 4200)
      timers.current.push(timer)
    },
    [],
  )

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <Box position="fixed" bottom="4" right="4" style={{ zIndex: 100, maxWidth: 380 }}>
        {toasts.map((toast) => (
          <Box
            key={toast.id}
            mb="2"
            p="3"
            style={{
              background: 'var(--color-panel-solid)',
              border: '1px solid var(--gray-a5)',
              borderRadius: 'var(--radius-3)',
              boxShadow: 'var(--shadow-4)',
            }}
            data-testid={`toast-${toast.variant}`}
          >
            <Flex gap="2" align="start">
              <Text
                size="2"
                weight="medium"
                color={
                  toast.variant === 'error'
                    ? 'red'
                    : toast.variant === 'success'
                      ? 'grass'
                      : undefined
                }
              >
                {toast.title}
              </Text>
            </Flex>
            {toast.description ? (
              <Text as="div" size="1" color="gray" mt="1">
                {toast.description}
              </Text>
            ) : null}
          </Box>
        ))}
      </Box>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
