# MTR Transmissões

Site de salas de transmissão em tempo real usando Vercel + LiveKit.

Variáveis necessárias na Vercel:
- LIVEKIT_URL
- LIVEKIT_API_KEY
- LIVEKIT_API_SECRET

A API Secret é usada somente no endpoint do servidor (`/api/token`) e nunca é enviada ao navegador.
