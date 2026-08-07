// internal
import Kree4n from '@kree4js/kree4n'
import Logging from '@kree4js/commons-logging'

// vars
Logging.setLevel('DEBUG')
const logger = Logging.getLogger('create-node')

/**
 * 使用 create() 一键创建配置完备的 KreeX 节点。
 *
 * create() 自动注册了 BinaryProtocol + 所有网络传输协议。
 */
async function main() {
  // 方式 1：仅指定 name
  const node1 = Kree4n.create('node-1')

  // 方式 2：指定 name + description
  const node2 = Kree4n.create('node-2', 'A demo node')

  logger.info('=== 节点信息 ===')
  logger.info(`node1 id: ${node1.id}, name: ${node1.name}`)
  logger.info(`node2 id: ${node2.id}, name: ${node2.name}, desc: ${node2.description}`)

  logger.info('')
  logger.info('=== 已注册的网络层连接提供器（ConnectionProvider） ===')
  const providers = node1.transport.ports.connectionProviders.providers()
  for (const provider of providers) {
    logger.info(`  - ${provider.name()}`)
  }
}

main().catch((err) => logger.error(err))
