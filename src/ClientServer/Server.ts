export default interface Server {
  shutdown(): void; // Kill the server after disconnecting all clients
}