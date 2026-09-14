# Voidfun — decisões da primeira versão

## Escopo autorizado

- Aplicativo separado do protocolo VoidChains, na Deed 0001, Robinhood Testnet (46630).
- Curva inspirada no mecanismo V2 da PONs. Não é uma cópia completa do produto, hooks ou contratos PONs.
- Referência inicial de FDV: US$ 3.000, convertida para ETH pelo NativePrice na criação. Os parâmetros em ETH permanecem fixos; a cotação posterior em dólares pode mudar.
- Sem penalidade de abertura, espera, lotes ou privilégios de compra para o criador. Não foram adicionadas as simulações de proteção contra MEV sugeridas anteriormente e rejeitadas pelo usuário.
- O usuário aceita que esta versão de teste encerre compra e venda ao completar a curva, sem criar pool Uniswap. Não há promessa de venda ou retirada posterior da reserva.
- Taxas da aplicação e pedágio da Deed são independentes. Aprovação de token na venda é para o contrato Curve, limitada ao valor escolhido na interface.

## Parâmetros da versão implantada na testnet

- Supply fixo: 1 bilhão; 80% vendidos na curva e 20% retidos no encerramento. Esta proporção é uma escolha desta versão de teste, não uma afirmação sobre a configuração atual da PONs.
- Taxa de negociação: 1%; 30% dessa taxa para a tesouraria Voidfun e 70% para o criador. Em uma compra de 1 ETH: 0,99 ETH entra na reserva, 0,003 ETH é receita Voidfun e 0,007 ETH é receita do criador; pedágio e gas são adicionais.
- Criação: zero; buyback desligado.
- Após a instrução do usuário para concluir a launchpad funcional, estes valores foram usados na implantação de teste de 2026-09-14. Não representam configuração atual comprovada da PONs. Tesouraria Voidfun: carteira do usuário `0xA7a12A1D7000e40Ecc18a62Af456791b89cB2770`.
- O minOut na interface é 99% da cotação; o prazo da execução é dez minutos. São condições normais da ordem, não uma promessa de impedir bots ou front-running.

## Fontes e limites

O código PONs no commit `856109de39458ce9f192380bff780549604fab7c` fornece defaults de 100 bps de negociação e 3000 bps de participação do protocolo. Taxa de criação é configurável. Não foi possível confirmar sua configuração atual on-chain. Não chamamos os candidatos de taxas atuais da PONs.

A documentação oficial Uniswap consultada lista Robinhood mainnet 4663; não foi verificada implantação V4 oficial na testnet 46630. Isso não demonstra ausência universal de contratos nessa testnet. Esta versão não depende de uma DEX.

Veja [ESTUDO-LAUNCHPAD-PT.md](ESTUDO-LAUNCHPAD-PT.md) para a pesquisa e fontes originais. Propostas de proteção naquele estudo são histórico de análise; o escopo vigente é este documento.
