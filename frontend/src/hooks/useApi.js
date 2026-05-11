import { useState, useCallback } from 'react'

export function useApi(apiFn, options = {}) {
  const [data, setData] = useState(options.initialData ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const execute = useCallback(async (...args) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFn(...args)
      setData(res.data)
      options.onSuccess?.(res.data)
      return res.data
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Errore'
      setError(msg)
      options.onError?.(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }, [apiFn])

  return { data, loading, error, execute, setData }
}
