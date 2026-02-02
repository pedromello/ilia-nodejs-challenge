## Como subir o projeto

Suba os containers do banco antes dos microserviços. Precisamos fazer isso pois, por falta de tempo, acabei não ajustando o compose para esperar os bancos ficarem health antes de subir os microserviços.
`docker compose up -d --build users-db transactions-db`

`docker compose up -d --build`

## Fundação
Framework utilizado NestJS por ser robusto e implementar uma arquitetura bem modular e fácil de entender. Além de eu já ter experiência com este framework.

Para banco de dados, optei por Prostgres com Pisma como ORM. Para implementações de ledgers, bancos relacionais fazem muito sentido, e dentre eles o Postgres é uma ótima opção. Já o prisma ao invés de um TypeORM, é mais por costume meu em utilizar este ORM e saber que ambos resolveriam bem o problema.

Para a comunicação entre microserviços utilizei chamadas http padrão pela rapidez. Porém o NestJS disponibiliza uma camada de comunicação para microserviços que poderíamos usar para uma aplicação que vá de fato para produção. Neste caso utilizaria uma comunicação por mensageria com RabbitMQ ou Kafka.

### Github
Criei um workflow de testes automatizados no github actions para validar e possivelmente bloquear o merge de uma PR que quebre o sistema.

Criei Milestones, issues e releases conforme fui implementando pedaços deste sistema.

## Users
Implementação da autenticação na mão com 2 tipos de Guards.

**JwtAuthGuard (Externo)**
Guard utilizado para camada de autenticação de usuários da plataforma. Gerenciado e assinado somente pelo users microservice

**InternalJwtAuthGuard (Interno)**
Guard para autenticação de chamadas internas. Outros microserviços podem assinar este JWT e o microserviço de users vai apenas validá-lo.

Utilizado no endpoint `/validate-user-jwt`

**Autorização**
O service dos endpoints fazem a validação de autorização para checar se o usuário está tentando acessar informações dele próprio ou de outro usuário.

**Testes**
Um simples teste de integração para validar a integridade do serviço e sua conexão com o banco e testes unitários do serviço como um todo.

Se tivesse mais tempo colocaria testes de integração para todos os use cases do sistema.

## Wallet (chamada de Transactions)

### Auth
A autenticação deste microserviço chama o microserviço de Users através da chamada ao endpoint `/validate-user-jwt` passando no header o JWT interno assinado com validade de 1 minuto.

Este endpoint recebe no seu body o "user_token" e responde se o token está valido e a qual user_id ele pertence.

### Modelagem
Optei por uma modelagem utilizando uma Ledger para guardar todas as transações de forma imutável na tabela Transaction.

Para evitar problemas de escalabilidade com o volume de transações de um usuário crescer muito, utilizei a tabela de Account que funciona como um snapshot dos dados consolidados de Transaction.

Dessa forma quando uma nova transação é inserida na base, o saldo é atualizado automaticamente.

### Idempotência e Concorrência
Para lidar com o problema de requisições duplicadas, implementei uma tabela de idempotência na base. Optei por esta abordagem na própria base de dados para agilizar a implementação, mas o ideal seria utilizar um Cache no Redis para melhor performance.
*OBS:* Nos testes finais percebi que a idempotência não é obrigatória no endpoint. Eu ajustaria isso se tivesse mais tempo.

Já para lidar com problemas de concorrência e consistência dos dados, para adicionar uma transação nova no banco nós utilizamos o SELECT FOR UPDATE para garantir que apenas aquela thread está alterando os dados daquele usuário além de fazer com que todo o processo de validação de balance e aprovação da transação seja feita de forma atômica.

## TODOS
Como TODOs eu focaria na implementação dos testes integrados para garantir que o sistema esteja funcionando corretamente.

Além disso, eu adicionaria a idempotencia com redis, e utilizaria a implementação padrão do NestJS para mensageria com RabbitMQ ou Kafka entre microserviços. 