# 🔮 Prediction Pool | Solana + Pyth Network

![Solana](https://img.shields.io/badge/Solana-362D59?style=for-the-badge&logo=solana&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![Anchor](https://img.shields.io/badge/Anchor-000000?style=for-the-badge&logo=anchor&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

Un mercado de predicciones 100% descentralizado y *trustless* (sin necesidad de confianza) construido en la blockchain de **Solana**. Esta dApp permite a los usuarios crear, participar y resolver mercados de predicción sin depender de intermediarios centralizados. Utiliza los oráculos de **Pyth Network** para resoluciones financieras automáticas y un modo manual para eventos sociales.

🎥 **[Mira el Video de Demostración Aquí](https://youtu.be/M_JOscEdWOo?si=Zbe2Bwsk6enDYDjE)**

## ✨ Características Principales

* **⚡ Resolución Automatizada (Pyth Network):** Crea mercados financieros. El Smart Contract obtiene automáticamente datos en tiempo real de los oráculos de Pyth para declarar al ganador.
* **🤝 Resolución Manual (Modo Social):** Crea pools personalizados para eventos del mundo real (deportes, clima, política) donde el creador del mercado actúa como el juez final.
* **🔒 Bóvedas On-Chain (Vaults):** La liquidez se bloquea de forma segura en PDAs (Program Derived Addresses). Nadie puede acceder a los fondos hasta que el mercado se resuelva oficialmente.
* **💸 Pagos Instantáneos:** Los ganadores reclaman sus recompensas proporcionales directamente a sus wallets Phantom inmediatamente después de la resolución.

## 📜 Smart Contract (Devnet)

* **Program ID:** `7NLjaEBsWDCXH9cETogmG1WuPnMnQEVyWgEYY5d3YB3g`

### 🔗 Transacciones de Demostración On-Chain
Pruebas de la ejecución real del contrato en la red Devnet:
* **Create Pool:** `3T7QcSijCGmCQKkqJDXYK92nENjocsatWXsYcSixV6bLdE48CNfUHcNRMjvsATqScbazEUTHBT2bEvPqaZYRtkn`
* **Join Pool:** `MpdgQeFxxWFHfEGLBHrp8PZ8y676iy9oKVPdTjCwfoUeVWABqMTrDZyTD8QT6hyYaojoSJ18CDBytivqDSvsCh`
* **Resolve Pool:** `2KTY5B7az8oTVWQN3x4jBUsFh5HDP1asyQGgBXimcRgFAyP37FpHWTbHDzJvGMUFdmsgKCfQJjfdvyMDGZNLSWFc`
* **Claim:** `TNgS56z5o7ZTkqGSiZUSKVKokuaR7LPpWG7zJBZc76bFPwjDwAPvcVqE7dEVSBGDdqq3S36MaBDeQxnYLk4VUEP`

## 🏗️ Arquitectura

1. **Smart Contract (Programas):** Escrito en Rust utilizando el framework Anchor. Maneja la creación de los pools, la lógica de apuestas, la gestión de las bóvedas PDA y la verificación de cuentas de Pyth.
2. **Frontend:** Construido con React, TypeScript y TailwindCSS. Integra `@solana/wallet-adapter` para una conexión fluida.
3. **Oráculo:** Integración de `@pythnetwork/pyth-solana-receiver` para obtener flujos de precios seguros en Devnet.

## 🚀 Empezando (Desarrollo Local)

### Prerrequisitos
* Rust & Cargo
* Solana CLI (configurado en Devnet)
* Anchor CLI
* Node.js & npm

### 👨‍💻 Autor
Construido por un Desarrollador Web3 Full-Stack en solitario.
GitHub: @cruz-torres-dev
Aviso Legal: Este proyecto fue construido con fines educativos y para hackathons en la Devnet de Solana. No lo utilices con fondos reales en la Mainnet sin una auditoría de seguridad profesional.
