const chalkMock: any = (text: string) => text;
chalkMock.hex = () => (text: string) => text;
chalkMock.gray = (text: string) => text;
chalkMock.red = (text: string) => text;
chalkMock.green = (text: string) => text;
chalkMock.yellow = (text: string) => text;
chalkMock.blue = (text: string) => text;
chalkMock.white = (text: string) => text;
chalkMock.bold = (text: string) => text;

export default chalkMock;
module.exports = chalkMock;
