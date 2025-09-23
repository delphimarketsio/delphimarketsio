# Smart Contract Betting Platform

## Testing

1. Start the solana test validator:
   ```bash
   solana-test-validator --reset
   ```
2. In a separate terminal, run the tests:
   ```bash
   anchor test --skip-local-validator
   ```

## Deployment

1. Start the solana test validator:
   ```bash
   solana-test-validator --reset
   ```
2. In a separate terminal, test the program without a local validator to initialize the state:
   ```bash
   anchor test --skip-local-validator
   ```
2. Build the project:
   ```bash
    anchor build
    ```
3. Deploy the program:
    ```bash
    anchor deploy
    ```
4. Update the program ID and IDL files in the client code if necessary.
