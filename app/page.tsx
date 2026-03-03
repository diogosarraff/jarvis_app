"use client"

import { useEffect, useState } from "react"

export default function Home() {
  const [jogos, setJogos] = useState<any[]>([])
  const [jogoSelecionado, setJogoSelecionado] = useState<any>(null)
  const [oddBanca, setOddBanca] = useState("")
  const [resultado, setResultado] = useState<any>(null)

  useEffect(() => {
    async function buscarJogos() {
      const res = await fetch("/api/agenda-hoje")
      const json = await res.json()
      setJogos(json.data)
      if (json.data.length > 0) {
        setJogoSelecionado(json.data[0])
      }
    }

    buscarJogos()
  }, [])

  function calcular() {
    const probJarvis = 0.55
    const oddJusta = 1 / probJarvis
    const ev = probJarvis * (Number(oddBanca) - 1) - (1 - probJarvis)

    let farol = "vermelho"
    if (ev >= 0.05) farol = "verde"
    else if (ev >= 0) farol = "amarelo"

    setResultado({
      probJarvis,
      oddJusta,
      ev,
      farol,
    })
  }

  function getFarolColor(farol: string) {
    if (farol === "verde") return "#00ff88"
    if (farol === "amarelo") return "#ffaa00"
    return "#ff3b3b"
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Jarvis</h1>
      <p style={styles.subtitle}>Central de Comandos</p>

      <div style={styles.card}>
        <h2 style={styles.marketTitle}>🏀 Mercado Vencedor</h2>

        {jogos.length > 0 && (
          <select
            style={styles.select}
            value={jogoSelecionado?.id}
            onChange={(e) => {
              const jogo = jogos.find(j => j.id === Number(e.target.value))
              setJogoSelecionado(jogo)
              setResultado(null)
            }}
          >
            {jogos.map((jogo) => (
              <option key={jogo.id} value={jogo.id}>
                {jogo.casa} vs {jogo.fora}
              </option>
            ))}
          </select>
        )}

        {jogoSelecionado && (
          <>
            <div style={styles.row}>
              <button style={styles.teamButton}>
                {jogoSelecionado.casa}
              </button>
              <button style={styles.teamButton}>
                {jogoSelecionado.fora}
              </button>
            </div>

            <input
              type="number"
              placeholder="Digite a odd da banca"
              value={oddBanca}
              onChange={(e) => setOddBanca(e.target.value)}
              style={styles.input}
            />

            <button style={styles.calcButton} onClick={calcular}>
              Calcular
            </button>
          </>
        )}

        {resultado && (
          <div style={styles.resultBox}>
            <p>Probabilidade Jarvis: {(resultado.probJarvis * 100).toFixed(1)}%</p>
            <p>Odd Justa: {resultado.oddJusta.toFixed(2)}</p>
            <p>EV: {(resultado.ev * 100).toFixed(2)}%</p>
            <p style={{ color: getFarolColor(resultado.farol) }}>
              Farol: {resultado.farol.toUpperCase()}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: any = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#0f1115",
    color: "white",
    padding: "30px",
    fontFamily: "Arial",
  },
  title: {
    fontSize: "32px",
    fontWeight: "bold",
  },
  subtitle: {
    marginBottom: "30px",
    color: "#aaa",
  },
  card: {
    backgroundColor: "#1a1d24",
    padding: "25px",
    borderRadius: "12px",
    boxShadow: "0 0 20px rgba(0,0,0,0.5)",
  },
  marketTitle: {
    marginBottom: "20px",
  },
  select: {
    width: "100%",
    padding: "10px",
    marginBottom: "20px",
    borderRadius: "8px",
    border: "none",
  },
  row: {
    display: "flex",
    gap: "10px",
    marginBottom: "15px",
  },
  teamButton: {
    flex: 1,
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#2a2f3a",
    color: "white",
  },
  input: {
    width: "100%",
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    marginBottom: "15px",
  },
  calcButton: {
    width: "100%",
    padding: "14px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: "#ff6b00",
    color: "white",
    fontWeight: "bold",
  },
  resultBox: {
    marginTop: "20px",
    backgroundColor: "#111",
    padding: "15px",
    borderRadius: "8px",
  },
}