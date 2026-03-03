'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [jogos, setJogos] = useState<any[]>([])

  useEffect(() => {
    async function fetchJogos() {
      const { data, error } = await supabase
        .from('raw_jogos')
        .select('*')
        .limit(5)

      if (error) {
        console.error('Erro:', error)
      } else {
        setJogos(data || [])
      }
    }

    fetchJogos()
  }, [])

  return (
    <div style={{ padding: 20 }}>
      <h1>Primeiros Jogos</h1>
      <pre>{JSON.stringify(jogos, null, 2)}</pre>
    </div>
  )
}