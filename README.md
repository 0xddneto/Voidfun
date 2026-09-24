# Voidfun

Launchpad independente de teste para Robinhood Testnet, Ethereum Sepolia, Base Sepolia, Ink Sepolia e Arc Testnet. Integracao com a release `voiddeeds-genesis-20260922`. As implementacoes ficam prontas para publicacao manual na Deed escolhida. Nenhum gateway e publicado automaticamente. Veja [OPERATIONS.md](OPERATIONS.md) para cache, recuperacao e limites dos testes.

## Selecionar uma rede

O seletor Network define os contratos, RPC, explorador, lista de tokens, grafico e moeda usados pela interface. Com uma carteira conectada, a selecao solicita wallet_switchEthereumChain e, se necessario, wallet_addEthereumChain. A troca so e aplicada se a carteira confirmar a rede. Recusar mantem a selecao anterior. Cada transacao confere novamente rede e conta. WalletConnect anuncia as cinco redes; a carteira precisa suportar a rede escolhida.

Tokens e reservas existem somente na rede em que foram criados. Trocar de rede nao faz bridge nem duplica tokens. A Arc usa USDC nativo com 18 casas na interface EVM; as outras redes usam ETH. Nao ha conversao de ativos entre redes.

## Publicacao manual na Deed

1. Escolha a rede na Voidfun e copie a Implementation exibida. Os enderecos verificados estao em `src/networks.json`, o manifesto ativo unico.
2. No protocolo, abra My Deeds e ative a Deed 0001 na rede de destino, se necessario. Sepolia segue a propriedade do NFT diretamente.
3. Em Build, selecione a mesma rede, Deed 1, a Implementation correspondente e Initialization bytes `0x`.
4. Assine Publish application na sua carteira e aguarde confirmacao. Somente esta acao sua registra o aplicativo na Deed.
5. Guarde o hash da publicacao. `node scripts/attach-gateway.mjs --chain=ID --deed=NUMERO --tx=HASH --publisher=CARTEIRA` verifica o recibo, fabrica, registro, Deed, implementation e publisher antes de atualizar o manifesto local. O script nao assina nem envia transacoes. Depois publique o frontend atualizado.
6. Crie o token e teste compra/venda. Cada rede fica liberada individualmente depois que seu gateway for registrado no manifesto.

A interface mostra as taxas lidas da implementation mesmo antes da publicacao. Criacao e negociacao permanecem indisponiveis enquanto nao houver gateway nessa rede. As transacoes publicas de criacao/compra/venda serao feitas manualmente pelo usuario; os testes de integracao automatizados usam somente Anvil local.

## Economia

Criacao zero. Taxa de negociacao de 1%, dividida em 30% para a tesouraria Voidfun e 70% para o criador. Tesouraria Voidfun: `0xA7a12A1D7000e40Ecc18a62Af456791b89cB2770`. O pedagio da Deed e separado: 90% para o dono e 10% para o tesouro do protocolo. Gas tambem e separado.

A curva usa reserva virtual equivalente a USD 3000 na moeda nativa da rede, obtida do TestnetPriceOracle. A reserva real comeca em zero. Cada lancamento cria token ERC-20 e curva independentes. Reservas de negociacao ficam na curva, nunca na implementation.

Ao vender 80% da oferta, a curva encerra permanentemente compras e vendas; o excesso da ultima compra e devolvido. Nao ha migracao para Uniswap, resgate ou retirada administrativa da reserva nesta versao de teste. Criador e tesouraria podem sacar apenas suas taxas acumuladas, inclusive apos unregister. Nao usar fundos reais.

## Desenvolvimento e verificacao

Node 22+; npm ci, npm run compile, npm test, node scripts/test-networks.mjs, npm run build. Anvil e instalado como dependencia opcional no Windows; em outros sistemas instale no PATH.

TEST_CHAIN_ID permite executar a integracao local com o chain ID de cada testnet. Arc usa cotacao de USD 1 por unidade nativa no teste; as demais USD 2000. Evidencias em `verification/local-tests-ID.json`. Estes testes nao sao auditoria independente nem substituem aceitacao em carteira real.

`node scripts/verify-deployment.mjs ID` compara bytecode executavel, immutables e taxas contra o deploymentManifest ativo em `src/networks.json`. A comparacao de bytecode remove metadados Solidity e verifica immutables separadamente. Cada implementation valida o Runtime pela fabrica atual, sem exigir que uma Deed ja tenha Runtime no momento do deploy. `node scripts/check-readiness.mjs ID` consulta disponibilidade sem escrever.

## Implantacao das implementacoes

`scripts/deploy.mjs` exige --chain, --trade-bps, --protocol-share-bps, --creation-fee-wei e --treasury explicitos. A chave VOIDFUN_DEPLOYER_KEY entra somente no ambiente do processo. Nao executar dois deploys com a mesma carteira/rede simultaneamente. O script implanta apenas LaunchToken, LaunchCurve e Voidfun; nao publica gateways. Persiste recibos por rede, release e fabrica em deployments e transacoes assinadas em .tools/, fora do Git. Retentativas reutilizam os recibos e transacoes da mesma rede.

## Carteiras

Extensoes via EIP-6963, fallback EIP-1193 e WalletConnect. VITE_WALLETCONNECT_PROJECT_ID deve pertencer ao projeto Reown Voidfun e permitir a origem publicada. Nenhuma chave privada entra no frontend. A aprovacao real em carteira movel continua sendo teste manual.

## Proveniencia

Matematica de reservas virtuais inspirada na PONs, sem importar seus hooks: https://github.com/ponsdotdev/ponsfamily e https://github.com/pump-fun/pump-public-docs. OpenZeppelin mantem suas licencas. tests/protocol contem fixtures locais; nao substitui contratos publicos. Estudos e decisoes historicos permanecem nos documentos originais e archive.
