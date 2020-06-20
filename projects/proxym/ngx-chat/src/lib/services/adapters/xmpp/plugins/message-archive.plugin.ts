import {jid as parseJid, xml} from '@xmpp/client';
import {filter} from 'rxjs/operators';
import {Direction} from '../../../../core/message';
import {Stanza} from '../../../../core/stanza';
import {LogService} from '../../../log.service';
import {XmppChatAdapter} from '../xmpp-chat-adapter.service';
import {AbstractXmppPlugin} from './abstract-xmpp-plugin';
import {MessageUuidPlugin} from './message-uuid.plugin';
import {ServiceDiscoveryPlugin} from './service-discovery.plugin';

/**
 * https://xmpp.org/extensions/xep-0313.html
 * Message Archive Management
 */
export class MessageArchivePlugin extends AbstractXmppPlugin {

    constructor(
        private chatService: XmppChatAdapter,
        private serviceDiscoveryPlugin: ServiceDiscoveryPlugin,
        private logService: LogService,
    ) {
        super();
        this.chatService.state$
            .pipe(filter(state => state === 'online'))
            .subscribe(async () => {
                if (await this.supportsMessageArchiveManagement()) {
                    this.requestNewestMessages();
                }
            });
    }

    private requestNewestMessages() {
        this.chatService.chatConnectionService.sendIq(
            xml('iq', {type: 'set', to: this.chatService.chatConnectionService.userJid.bare().toString()},
                xml('query', {xmlns: 'urn:xmpp:mam:2'},
                    xml('set', {xmlns: 'http://jabber.org/protocol/rsm'},
                        xml('max', {}, 250),
                        xml('before'),
                    ),
                ),
            ),
        );
    }

    async loadAllMessages() {
        if (!(await this.supportsMessageArchiveManagement())) {
            throw new Error('message archive management not suppported');
        }

        let lastMamResponse = await this.chatService.chatConnectionService.sendIq(
            xml('iq', {type: 'set'},
                xml('query', {xmlns: 'urn:xmpp:mam:2'}),
            ),
        );

        while (lastMamResponse.getChild('fin').attrs.complete !== 'true') {
            const lastReceivedMessageId = lastMamResponse.getChild('fin').getChild('set').getChildText('last');
            lastMamResponse = await this.chatService.chatConnectionService.sendIq(
                xml('iq', {type: 'set'},
                    xml('query', {xmlns: 'urn:xmpp:mam:2'},
                        xml('set', {xmlns: 'http://jabber.org/protocol/rsm'},
                            xml('max', {}, 250),
                            xml('after', {}, lastReceivedMessageId),
                        ),
                    ),
                ),
            );
        }
    }

    private async supportsMessageArchiveManagement() {
        const supportsMessageArchiveManagement = await this.serviceDiscoveryPlugin.supportsFeature(
            this.chatService.chatConnectionService.userJid.bare().toString(), 'urn:xmpp:mam:2');
        if (!supportsMessageArchiveManagement) {
            this.logService.info('server doesnt support MAM');
        }
        return supportsMessageArchiveManagement;
    }

    handleStanza(stanza: Stanza) {
        if (this.isMamMessageStanza(stanza)) {
            this.handleMamMessageStanza(stanza);
            return true;
        }
        return false;
    }

    private isMamMessageStanza(stanza: Stanza) {
        const result = stanza.getChild('result');
        return stanza.name === 'message' && result && result.attrs.xmlns === 'urn:xmpp:mam:2';
    }

    private handleMamMessageStanza(stanza: Stanza) {
        const messageElement = stanza.getChild('result').getChild('forwarded').getChild('message');
        const isAddressedToMe = this.chatService.chatConnectionService.userJid.bare()
            .equals(parseJid(messageElement.attrs.to).bare());

        const messageBody = messageElement.getChildText('body');
        if (messageBody && messageBody.trim()) {
            const contactJid = isAddressedToMe ? messageElement.attrs.from : messageElement.attrs.to;
            const contact = this.chatService.getOrCreateContactById(contactJid);
            const datetime = new Date(
                stanza.getChild('result').getChild('forwarded').getChild('delay').attrs.stamp,
            );
            const direction = isAddressedToMe ? Direction.in : Direction.out;

            contact.addMessage({
                direction,
                datetime,
                body: messageBody,
                id: MessageUuidPlugin.extractIdFromStanza(messageElement),
                delayed: true,
            });
        }
    }
}
