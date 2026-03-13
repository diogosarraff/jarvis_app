“use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "../lib/supabase"

type AgendaGame = {
  id: number
  data: string
  casa: string
  fora: string
  game_id: string
}

type PredJogo = {
  game_id: string
  proj_home_pts: number | null
  proj_away_pts: number | null
  proj_total: number | null
  proj_spread_home: number | null
  home_win_prob: number | null
  away_win_prob: number | null
}

type PredJogador = {
  game_id: string
  player_name: string
  team: string
  proj_pts: number | null
  proj_reb: number | null
  proj_ast: number | null
  proj_fg3m: number | null
}

type SavedBet = {
  id: string
  gameId: string
  jogo: string
  mercado: string
  selecao: string
  linha?: number | null
  oddCasa: number
  prob: number
  oddJusta: number
  ev: number
  farol: "verde" | "amarelo" | "vermelho"
}

type CalcResult = {
  prob: number
  oddJusta: number
  ev: number
  farol: "verde" | "amarelo" | "vermelho"
  detalhes?: string
}

const PLAYER_THRESHOLDS = {
  pts: [5, 10, 15, 20, 25, 30],
  ast: [3, 5, 7, 10, 13, 15],
  reb: [3, 5, 7, 10, 13, 15],
  fg3m: [1, 2, 3, 4, 5, 6],
}

const PLAYER_SIGMA: Record<string, number> = {
  pts: 6.5,
  reb: 3.0,
  ast: 2.5,
  fg3m: 1.5,
}

const TOTAL_SIGMA = 12
const SPREAD_SIGMA = 11.5

export default function Home() {
  const [jogos, setJogos] = useState<AgendaGame[]>([])
  const [predJogos, setPredJogos] = useState<Record<string, PredJogo>>({})
  const [predJogadores, setPredJogadores] = useState<PredJogador[]>([])
const [playerOdds,setPlayerOdds] = useState<Record<string,string>>({})

  const [jogoSelecionado, setJogoSelecionado] = useState<AgendaGame | null>(null)

  const [mercadoAtivo, setMercadoAtivo] = useState<"winner" | "total" | "handicap" | "players">("winner")

  // Winner
  const [timeWinner, setTimeWinner] = useState<string | null>(null)
  const [oddWinner, setOddWinner] = useState("")
  const [resultadoWinner, setResultadoWinner] = useState<CalcResult | null>(null)

  // Total
  const [sideTotal, setSideTotal] = useState<"over" | "under">("over")
  const [linhaTotal, setLinhaTotal] = useState("")
  const [oddTotal, setOddTotal] = useState("")
  const [resultadoTotal, setResultadoTotal] = useState<CalcResult | null>(null)

  // Handicap
  const [timeHandicap, setTimeHandicap] = useState<string | null>(null)
  const [linhaHandicap, setLinhaHandicap] = useState("")
  const [oddHandicap, setOddHandicap] = useState("")
  const [resultadoHandicap, setResultadoHandicap] = useState<CalcResult | null>(null)

  // Players
  const [playerMarket, setPlayerMarket] = useState<"pts" | "ast" | "reb" | "fg3m">("pts")
  const [playerName, setPlayerName] = useState("")
  const [playerLine, setPlayerLine] = useState("")
  const [playerOdd, setPlayerOdd] = useState("")
  const [resultadoPlayer, setResultadoPlayer] = useState<CalcResult | null>(null)

  const [savedBets, setSavedBets] = useState<SavedBet[]>([])

  useEffect(() => {
    async function carregarTudo() {
      const { data: agendaData } = await supabase
        .from("agenda_hoje")
        .select("*")
        .order("data", { ascending: true })

      const { data: jogosPredData } = await supabase
        .from("predicoes_jogos")
        .select("*")

      const { data: jogadoresPredData } = await supabase
        .from("predicoes_jogadores")
        .select("*")

      const agenda = (agendaData || []) as AgendaGame[]
      const pj = (jogosPredData || []) as PredJogo[]
      const pp = (jogadoresPredData || []) as PredJogador[]

      const jogosMap: Record<string, PredJogo> = {}
      pj.forEach((item) => {
        jogosMap[item.game_id] = item
      })

      setJogos(agenda)
      setPredJogos(jogosMap)
      setPredJogadores(pp)

      if (agenda.length > 0) {
        setJogoSelecionado(agenda[0])
      }
    }

    carregarTudo()
  }, [])

  const predJogoAtual = useMemo(() => {
    if (!jogoSelecionado) return null
    return predJogos[jogoSelecionado.game_id] || null
  }, [jogoSelecionado, predJogos])

  const jogadoresDoJogo = useMemo(() => {
    if (!jogoSelecionado) return []
    return predJogadores.filter((j) => j.game_id === jogoSelecionado.game_id)
  }, [jogoSelecionado, predJogadores])

  useEffect(() => {
    // reset ao trocar jogo
    setMercadoAtivo("winner")

    setTimeWinner(null)
    setOddWinner("")
    setResultadoWinner(null)

    setSideTotal("over")
    setLinhaTotal("")
    setOddTotal("")
    setResultadoTotal(null)

    setTimeHandicap(null)
    setLinhaHandicap("")
    setOddHandicap("")
    setResultadoHandicap(null)

    setPlayerMarket("pts")
    setPlayerName("")
    setPlayerLine("")
    setPlayerOdd("")
    setResultadoPlayer(null)
  }, [jogoSelecionado?.game_id])

  useEffect(() => {
    // reset da prop ao trocar tipo
    setPlayerName("")
    setPlayerLine("")
    setPlayerOdd("")
    setResultadoPlayer(null)
  }, [playerMarket])

  const ranking = useMemo(() => {
    return [...savedBets].sort((a, b) => b.ev - a.ev)
  }, [savedBets])

  function normalCdf(x: number, mean: number, sd: number) {
    const z = (x - mean) / (sd * Math.sqrt(2))
    return 0.5 * (1 + erf(z))
  }

  function erf(x: number) {
    const sign = x >= 0 ? 1 : -1
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const absX = Math.abs(x)
    const t = 1 / (1 + p * absX)
    const y =
      1 -
      (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
        Math.exp(-absX * absX)

    return sign * y
  }

  function calcOddJusta(prob: number) {
    if (prob <= 0) return 999
    if (prob >= 1) return 1.01
    return 1 / prob
  }

  function calcEV(prob: number, odd: number) {
    return prob * odd - 1
  }

  function farolFromEV(ev: number): "verde" | "amarelo" | "vermelho" {
    if (ev > 0.05) return "verde"
    if (ev >= 0) return "amarelo"
    return "vermelho"
  }

  function getFarolColor(farol: string) {
    if (farol === "verde") return "#00d26a"
    if (farol === "amarelo") return "#ffb020"
    return "#ff5c5c"
  }

  function calcularWinner() {
    if (!jogoSelecionado || !predJogoAtual || !timeWinner || !oddWinner) return

    const odd = Number(oddWinner)
    if (!Number.isFinite(odd) || odd <= 1) return

    const prob =
      timeWinner === jogoSelecionado.casa
        ? Number(predJogoAtual.home_win_prob || 0)
        : Number(predJogoAtual.away_win_prob || 0)

    const oddJusta = calcOddJusta(prob)
    const ev = calcEV(prob, odd)
    const farol = farolFromEV(ev)

    setResultadoWinner({
      prob,
      oddJusta,
      ev,
      farol,
      detalhes: `Jarvis vê ${timeWinner} com ${(prob * 100).toFixed(1)}% de chance.`,
    })
  }

  function calcularTotal() {
    if (!predJogoAtual || !linhaTotal || !oddTotal) return

    const line = Number(linhaTotal)
    const odd = Number(oddTotal)
    if (!Number.isFinite(line) || !Number.isFinite(odd) || odd <= 1) return

    const media = Number(predJogoAtual.proj_total || 0)
    const prob =
      sideTotal === "over"
        ? 1 - normalCdf(line, media, TOTAL_SIGMA)
        : normalCdf(line, media, TOTAL_SIGMA)

    const oddJusta = calcOddJusta(prob)
    const ev = calcEV(prob, odd)
    const farol = farolFromEV(ev)

    setResultadoTotal({
      prob,
      oddJusta,
      ev,
      farol,
      detalhes: `Projeção Jarvis do total: ${media.toFixed(1)} pts.`,
    })
  }

  function calcularHandicap() {
    if (!jogoSelecionado || !predJogoAtual || !timeHandicap || !linhaHandicap || !oddHandicap) return

    const line = Number(linhaHandicap)
    const odd = Number(oddHandicap)
    if (!Number.isFinite(line) || !Number.isFinite(odd) || odd <= 1) return

    const media = Number(predJogoAtual.proj_spread_home || 0)

    let prob = 0
    if (timeHandicap === jogoSelecionado.casa) {
      prob = 1 - normalCdf(-line, media, SPREAD_SIGMA)
    } else {
      prob = normalCdf(line, media, SPREAD_SIGMA)
    }

    const oddJusta = calcOddJusta(prob)
    const ev = calcEV(prob, odd)
    const farol = farolFromEV(ev)

    setResultadoHandicap({
      prob,
      oddJusta,
      ev,
      farol,
      detalhes: `Spread projetado Jarvis (casa): ${media.toFixed(1)}.`,
    })
  }

  function calcularPlayer() {
    if (!playerName || !playerLine || !playerOdd) return

    const jogador = jogadoresDoJogo.find((j) => j.player_name === playerName)
    if (!jogador) return

    const line = Number(playerLine)
    const odd = Number(playerOdd)
    if (!Number.isFinite(line) || !Number.isFinite(odd) || odd <= 1) return

    let media = 0
    if (playerMarket === "pts") media = Number(jogador.proj_pts || 0)
    if (playerMarket === "reb") media = Number(jogador.proj_reb || 0)
    if (playerMarket === "ast") media = Number(jogador.proj_ast || 0)
    if (playerMarket === "fg3m") media = Number(jogador.proj_fg3m || 0)

    const sigma = PLAYER_SIGMA[playerMarket]
    const prob = 1 - normalCdf(line - 0.5, media, sigma)

    const oddJusta = calcOddJusta(prob)
    const ev = calcEV(prob, odd)
    const farol = farolFromEV(ev)

    setResultadoPlayer({
      prob,
      oddJusta,
      ev,
      farol,
      detalhes: `Projeção Jarvis para ${playerName}: ${media.toFixed(playerMarket === "fg3m" ? 2 : 1)}.`,
    })
  }

  function guardarAposta(aposta: SavedBet) {
    const exists = savedBets.some((b) => b.id === aposta.id)
    if (exists) return
    setSavedBets((prev) => [...prev, aposta])
  }

  function removerAposta(id: string) {
    setSavedBets((prev) => prev.filter((b) => b.id !== id))
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Jarvis</h1>
          <p style={styles.subtitle}>MVP operacional do dia</p>
        </div>

        <div style={styles.headerInfo}>
          <span style={styles.badge}>{jogos.length} jogos</span>
          <span style={styles.badge}>{savedBets.length} guardadas</span>
        </div>
      </div>

      <div style={styles.sectionCard}>
        <h2 style={styles.sectionTitle}>Jogos de hoje</h2>

        <div style={styles.gamesList}>
          {jogos.map((jogo) => (
            <button
              key={jogo.id}
              onClick={() => setJogoSelecionado(jogo)}
              style={{
                ...styles.gameCard,
                backgroundColor:
                  jogoSelecionado?.id === jogo.id ? "#ff6b00" : "#242934",
                boxShadow:
                  jogoSelecionado?.id === jogo.id
                    ? "0 6px 18px rgba(255,107,0,0.35)"
                    : "none",
              }}
            >
              <div style={styles.gameTeams}>
                {jogo.casa} <span style={{ opacity: 0.7 }}>vs</span> {jogo.fora}
              </div>
              <div style={styles.gameDate}>{jogo.data}</div>
            </button>
          ))}
        </div>
      </div>

      {jogoSelecionado && (
        <div style={styles.sectionCard}>
          <h2 style={styles.sectionTitle}>
            Mercado — {jogoSelecionado.casa} vs {jogoSelecionado.fora}
          </h2>

          <div style={styles.tabsRow}>
            <button
              style={{ ...styles.tabButton, ...(mercadoAtivo === "winner" ? styles.tabButtonActive : {}) }}
              onClick={() => setMercadoAtivo("winner")}
            >
              Vencedor
            </button>
            <button
              style={{ ...styles.tabButton, ...(mercadoAtivo === "total" ? styles.tabButtonActive : {}) }}
              onClick={() => setMercadoAtivo("total")}
            >
              Total
            </button>
            <button
              style={{ ...styles.tabButton, ...(mercadoAtivo === "handicap" ? styles.tabButtonActive : {}) }}
              onClick={() => setMercadoAtivo("handicap")}
            >
              Handicap
            </button>
            <button
              style={{ ...styles.tabButton, ...(mercadoAtivo === "players" ? styles.tabButtonActive : {}) }}
              onClick={() => setMercadoAtivo("players")}
            >
              Jogadores
            </button>
          </div>

          {mercadoAtivo === "winner" && (
            <div style={styles.marketBox}>
              <div style={styles.row}>
                <button
                  onClick={() => setTimeWinner(jogoSelecionado.casa)}
                  style={{
                    ...styles.optionButton,
                    backgroundColor:
                      timeWinner === jogoSelecionado.casa ? "#ff6b00" : "#2a2f3a",
                  }}
                >
                  {jogoSelecionado.casa}
                </button>
                <button
                  onClick={() => setTimeWinner(jogoSelecionado.fora)}
                  style={{
                    ...styles.optionButton,
                    backgroundColor:
                      timeWinner === jogoSelecionado.fora ? "#ff6b00" : "#2a2f3a",
                  }}
                >
                  {jogoSelecionado.fora}
                </button>
              </div>

              <input
                type="number"
                step="0.01"
                placeholder="Odd da casa"
                value={oddWinner}
                onChange={(e) => setOddWinner(e.target.value)}
                style={styles.input}
              />

              <button style={styles.actionButton} onClick={calcularWinner}>
                Calcular
              </button>

              {resultadoWinner && (
                <ResultCard
                  resultado={resultadoWinner}
                  onSave={() =>
                    guardarAposta({
                      id: `${jogoSelecionado.game_id}-winner-${timeWinner}`,
                      gameId: jogoSelecionado.game_id,
                      jogo: `${jogoSelecionado.casa} vs ${jogoSelecionado.fora}`,
                      mercado: "Vencedor",
                      selecao: timeWinner || "",
                      oddCasa: Number(oddWinner),
                      prob: resultadoWinner.prob,
                      oddJusta: resultadoWinner.oddJusta,
                      ev: resultadoWinner.ev,
                      farol: resultadoWinner.farol,
                    })
                  }
                />
              )}
            </div>
          )}

          {mercadoAtivo === "total" && (
            <div style={styles.marketBox}>
              <div style={styles.row}>
                <button
                  onClick={() => setSideTotal("over")}
                  style={{
                    ...styles.optionButton,
                    backgroundColor: sideTotal === "over" ? "#ff6b00" : "#2a2f3a",
                  }}
                >
                  Over
                </button>
                <button
                  onClick={() => setSideTotal("under")}
                  style={{
                    ...styles.optionButton,
                    backgroundColor: sideTotal === "under" ? "#ff6b00" : "#2a2f3a",
                  }}
                >
                  Under
                </button>
              </div>

              <input
                type="number"
                step="0.5"
                placeholder="Linha da casa"
                value={linhaTotal}
                onChange={(e) => setLinhaTotal(e.target.value)}
                style={styles.input}
              />

              <input
                type="number"
                step="0.01"
                placeholder="Odd da casa"
                value={oddTotal}
                onChange={(e) => setOddTotal(e.target.value)}
                style={styles.input}
              />

              <button style={styles.actionButton} onClick={calcularTotal}>
                Calcular
              </button>

              {resultadoTotal && (
                <ResultCard
                  resultado={resultadoTotal}
                  onSave={() =>
                    guardarAposta({
                      id: `${jogoSelecionado.game_id}-total-${sideTotal}-${linhaTotal}`,
                      gameId: jogoSelecionado.game_id,
                      jogo: `${jogoSelecionado.casa} vs ${jogoSelecionado.fora}`,
                      mercado: "Total",
                      selecao: sideTotal.toUpperCase(),
                      linha: Number(linhaTotal),
                      oddCasa: Number(oddTotal),
                      prob: resultadoTotal.prob,
                      oddJusta: resultadoTotal.oddJusta,
                      ev: resultadoTotal.ev,
                      farol: resultadoTotal.farol,
                    })
                  }
                />
              )}
            </div>
          )}

          {mercadoAtivo === "handicap" && (
            <div style={styles.marketBox}>
              <div style={styles.row}>
                <button
                  onClick={() => setTimeHandicap(jogoSelecionado.casa)}
                  style={{
                    ...styles.optionButton,
                    backgroundColor:
                      timeHandicap === jogoSelecionado.casa ? "#ff6b00" : "#2a2f3a",
                  }}
                >
                  {jogoSelecionado.casa}
                </button>
                <button
                  onClick={() => setTimeHandicap(jogoSelecionado.fora)}
                  style={{
                    ...styles.optionButton,
                    backgroundColor:
                      timeHandicap === jogoSelecionado.fora ? "#ff6b00" : "#2a2f3a",
                  }}
                >
                  {jogoSelecionado.fora}
                </button>
              </div>

              <input
                type="number"
                step="0.5"
                placeholder="Linha da casa (ex.: -4.5 ou +4.5)"
                value={linhaHandicap}
                onChange={(e) => setLinhaHandicap(e.target.value)}
                style={styles.input}
              />

              <input
                type="number"
                step="0.01"
                placeholder="Odd da casa"
                value={oddHandicap}
                onChange={(e) => setOddHandicap(e.target.value)}
                style={styles.input}
              />

              <button style={styles.actionButton} onClick={calcularHandicap}>
                Calcular
              </button>

              {resultadoHandicap && (
                <ResultCard
                  resultado={resultadoHandicap}
                  onSave={() =>
                    guardarAposta({
                      id: `${jogoSelecionado.game_id}-hcp-${timeHandicap}-${linhaHandicap}`,
                      gameId: jogoSelecionado.game_id,
                      jogo: `${jogoSelecionado.casa} vs ${jogoSelecionado.fora}`,
                      mercado: "Handicap",
                      selecao: timeHandicap || "",
                      linha: Number(linhaHandicap),
                      oddCasa: Number(oddHandicap),
                      prob: resultadoHandicap.prob,
                      oddJusta: resultadoHandicap.oddJusta,
                      ev: resultadoHandicap.ev,
                      farol: resultadoHandicap.farol,
                    })
                  }
                />
              )}
            </div>
          )}

          {mercadoAtivo === "players" && (
  <div style={styles.marketBox}>

    {(["pts","ast","reb","fg3m"] as const).map((market)=>{

      const titulo =
        market==="pts"?"Pontos":
        market==="ast"?"Assistências":
        market==="reb"?"Rebotes":
        "Cestas de 3"

      return(

      <div key={market} style={{marginBottom:30}}>

        <h3 style={{marginBottom:10}}>{titulo}</h3>

        {jogadoresDoJogo
          .filter(j=>{

            const mediaMin = Number((j as any).min_avg || 25)
            const jogos = Number((j as any).games_count || 10)

            return mediaMin>=20 && jogos>=3
          })
          .map(j=>{

            let media =
              market==="pts"?Number(j.proj_pts||0):
              market==="reb"?Number(j.proj_reb||0):
              market==="ast"?Number(j.proj_ast||0):
              Number(j.proj_fg3m||0)

            const thresholds = PLAYER_THRESHOLDS[market]

            let linha = thresholds[0]

            for(let i=thresholds.length-1;i>=0;i--){
              if(media>=thresholds[i]){
                linha = thresholds[i]
                break
              }
            }

            const key = `${market}_${j.player_name}`

            return(

              <div
                key={key}
                style={{
                  display:"flex",
                  justifyContent:"space-between",
                  alignItems:"center",
                  background:"#11161d",
                  padding:10,
                  borderRadius:8,
                  marginBottom:6
                }}
              >

                <div>
                  <strong>{j.player_name}</strong> ({j.team})
                </div>

                <div>
                  {linha}+
                </div>

                <input
                  type="number"
                  step="0.01"
                  placeholder="odd"
                  value={playerOdds[key]||""}
                  onChange={(e)=>
                    setPlayerOdds({
                      ...playerOdds,
                      [key]:e.target.value
                    })
                  }
                  style={{
                    width:80,
                    padding:6,
                    borderRadius:6,
                    border:"1px solid #444",
                    background:"#000",
                    color:"#fff"
                  }}
                />

              </div>

            )

          })
        }

      </div>

      )

    })}

    <button
      style={styles.actionButton}
      onClick={()=>{

        const apostas:SavedBet[] = []

        jogadoresDoJogo.forEach(j=>{

          ;(["pts","ast","reb","fg3m"] as const).forEach(market=>{

            let media =
              market==="pts"?Number(j.proj_pts||0):
              market==="reb"?Number(j.proj_reb||0):
              market==="ast"?Number(j.proj_ast||0):
              Number(j.proj_fg3m||0)

            const thresholds = PLAYER_THRESHOLDS[market]

            let linha = thresholds[0]

            for(let i=thresholds.length-1;i>=0;i--){
              if(media>=thresholds[i]){
                linha = thresholds[i]
                break
              }
            }

            const key = `${market}_${j.player_name}`

            const odd = Number(playerOdds[key])

            if(!odd) return

            const sigma = PLAYER_SIGMA[market]

            const prob = 1-normalCdf(linha-0.5,media,sigma)

            const oddJusta = calcOddJusta(prob)

            const ev = calcEV(prob,odd)

            const farol = farolFromEV(ev)

            apostas.push({

              id:`auto_${market}_${j.player_name}`,
              gameId:jogoSelecionado!.game_id,
              jogo:`${jogoSelecionado!.casa} vs ${jogoSelecionado!.fora}`,
              mercado:market,
              selecao:`${j.player_name} ${linha}+`,
              linha,
              oddCasa:odd,
              prob,
              oddJusta,
              ev,
              farol

            })

          })

        })

        setSavedBets(apostas)

      }}
    >
      Calcular todas
    </button>

  </div>
)}
        </div>
      )}

      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <h2 style={styles.sectionTitle}>Apostas guardadas</h2>
          <span style={styles.badge}>{savedBets.length}</span>
        </div>

        {savedBets.length === 0 ? (
          <p style={styles.emptyText}>Nenhuma aposta guardada ainda.</p>
        ) : (
          <div style={styles.savedList}>
            {savedBets.map((bet) => (
              <div key={bet.id} style={styles.savedCard}>
                <div style={styles.savedTopRow}>
                  <div>
                    <div style={styles.savedTitle}>{bet.selecao}</div>
                    <div style={styles.savedSub}>
                      {bet.jogo} • {bet.mercado}
                      {bet.linha !== undefined && bet.linha !== null ? ` • linha ${bet.linha}` : ""}
                    </div>
                  </div>

                  <button style={styles.removeButton} onClick={() => removerAposta(bet.id)}>
                    Remover
                  </button>
                </div>

                <div style={styles.savedMetrics}>
                  <Metric label="Odd" value={bet.oddCasa.toFixed(2)} />
                  <Metric label="Prob" value={`${(bet.prob * 100).toFixed(1)}%`} />
                  <Metric label="Odd justa" value={bet.oddJusta.toFixed(2)} />
                  <Metric
                    label="EV"
                    value={`${(bet.ev * 100).toFixed(1)}%`}
                    color={getFarolColor(bet.farol)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <h2 style={styles.sectionTitle}>🔥 Melhores apostas do dia</h2>
          <span style={styles.badge}>{ranking.length}</span>
        </div>

        {ranking.length === 0 ? (
          <p style={styles.emptyText}>Guarde apostas para gerar o ranking.</p>
        ) : (
          <div style={styles.rankingList}>
            {ranking.map((bet, index) => (
              <div key={bet.id} style={styles.rankCard}>
                <div style={styles.rankNumber}>#{index + 1}</div>

                <div style={{ flex: 1 }}>
                  <div style={styles.savedTitle}>{bet.selecao}</div>
                  <div style={styles.savedSub}>
                    {bet.jogo} • {bet.mercado}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ color: getFarolColor(bet.farol), fontWeight: 700 }}>
                    {(bet.ev * 100).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>EV</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ResultCard({
  resultado,
  onSave,
}: {
  resultado: CalcResult
  onSave: () => void
}) {
  function getFarolColor(farol: string) {
    if (farol === "verde") return "#00d26a"
    if (farol === "amarelo") return "#ffb020"
    return "#ff5c5c"
  }

  return (
    <div style={styles.resultBox}>
      <div style={styles.resultGrid}>
        <Metric label="Prob Jarvis" value={`${(resultado.prob * 100).toFixed(1)}%`} />
        <Metric label="Odd justa" value={resultado.oddJusta.toFixed(2)} />
        <Metric
          label="EV"
          value={`${(resultado.ev * 100).toFixed(1)}%`}
          color={getFarolColor(resultado.farol)}
        />
        <Metric
          label="Farol"
          value={resultado.farol.toUpperCase()}
          color={getFarolColor(resultado.farol)}
        />
      </div>

      {resultado.detalhes && <p style={styles.detailsText}>{resultado.detalhes}</p>}

      <button style={styles.saveButton} onClick={onSave}>
        ⭐ Guardar aposta
      </button>
    </div>
  )
}

function Metric({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color: color || "white" }}>{value}</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#0f1115",
    color: "white",
    padding: "20px 16px 40px",
    fontFamily: "Arial, sans-serif",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  },

  title: {
    fontSize: 30,
    fontWeight: 700,
    margin: 0,
  },

  subtitle: {
    margin: "4px 0 0",
    color: "#9aa4b2",
    fontSize: 14,
  },

  headerInfo: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  badge: {
    backgroundColor: "#1f2530",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    color: "#d6dbe3",
  },

  sectionCard: {
    backgroundColor: "#1a1f28",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
  },

  sectionTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
  },

  sectionHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  gamesList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },

  gameCard: {
    width: "100%",
    border: "none",
    borderRadius: 12,
    padding: "14px 16px",
    color: "white",
    textAlign: "left",
    cursor: "pointer",
  },

  gameTeams: {
    fontWeight: 700,
    fontSize: 15,
  },

  gameDate: {
    marginTop: 4,
    fontSize: 12,
    opacity: 0.75,
  },

  tabsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 14,
    marginBottom: 14,
  },

  tabButton: {
    border: "none",
    borderRadius: 10,
    padding: "10px 12px",
    backgroundColor: "#2a2f3a",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
  },

  tabButtonActive: {
    backgroundColor: "#ff6b00",
  },

  marketBox: {
    marginTop: 6,
  },

  row: {
    display: "flex",
    gap: 10,
    marginBottom: 12,
  },

  rowWrap: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },

  optionButton: {
    flex: 1,
    border: "none",
    borderRadius: 10,
    padding: "12px 14px",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
  },

  smallTab: {
    border: "none",
    borderRadius: 10,
    padding: "10px 12px",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #3a4250",
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 12,
    backgroundColor: "#11161d",
    color: "white",
    fontSize: 14,
  },

  select: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #3a4250",
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 12,
    backgroundColor: "#11161d",
    color: "white",
    fontSize: 14,
  },

  actionButton: {
    width: "100%",
    border: "none",
    borderRadius: 12,
    padding: "14px 16px",
    backgroundColor: "#ff6b00",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },

  resultBox: {
    marginTop: 14,
    backgroundColor: "#11161d",
    borderRadius: 14,
    padding: 14,
  },

  resultGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
  },

  metricCard: {
    backgroundColor: "#1f2530",
    borderRadius: 12,
    padding: 12,
  },

  metricLabel: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 4,
  },

  metricValue: {
    fontSize: 16,
    fontWeight: 700,
  },

  detailsText: {
    marginTop: 12,
    marginBottom: 0,
    fontSize: 13,
    color: "#b8c0cc",
  },

  saveButton: {
    width: "100%",
    marginTop: 14,
    border: "none",
    borderRadius: 12,
    padding: "14px 16px",
    backgroundColor: "#00c853",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },

  emptyText: {
    margin: 0,
    color: "#9aa4b2",
  },

  savedList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },

  savedCard: {
    backgroundColor: "#11161d",
    borderRadius: 14,
    padding: 14,
  },

  savedTopRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },

  savedTitle: {
    fontWeight: 700,
    fontSize: 15,
  },

  savedSub: {
    marginTop: 4,
    fontSize: 12,
    color: "#9aa4b2",
  },

  removeButton: {
    border: "none",
    borderRadius: 10,
    padding: "8px 10px",
    backgroundColor: "#2a2f3a",
    color: "white",
    cursor: "pointer",
    fontSize: 12,
  },

  savedMetrics: {
    marginTop: 12,
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
  },

  rankingList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },

  rankCard: {
    backgroundColor: "#11161d",
    borderRadius: 14,
    padding: 14,
    display: "flex",
    alignItems: "center",
    gap: 12,
  },

  rankNumber: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: "#ff6b00",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    flexShrink: 0,
  },
}