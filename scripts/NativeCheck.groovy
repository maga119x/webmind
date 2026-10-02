// Optional compatibility test against an unpacked official FreeMind 1.0.1 distribution.
// Run with its lib/*, lib/jibx/*, lib/SimplyHTML/* and plugins/script/* on the classpath.
java.util.logging.Logger.getLogger('').setLevel(java.util.logging.Level.OFF)
def frame = new tests.freemind.FreeMindMainMock()
def controller = frame.getController()
if (controller == null) controller = new freemind.controller.Controller(frame)
def mode = new freemind.modes.mindmapmode.MindMapMode()
mode.init(controller)
def modeController = mode.createModeController()
def model = new freemind.modes.mindmapmode.MindMapMapModel(frame, modeController)
modeController.setModel(model)
def xml = new freemind.modes.mindmapmode.MindMapXMLElement(modeController)
def reader = new java.io.InputStreamReader(new java.io.FileInputStream(args[0]), 'UTF-8')
try { xml.parseFromReader(reader) } catch (Throwable e) { e.printStackTrace(); System.exit(1) }
reader.close()
def root = xml.getMapChild()
def count = 0
def stack = [root]
while (!stack.isEmpty()) {
  def node = stack.remove(stack.size()-1)
  count++
  node.getChildren().each { stack.add(it) }
}
if (args.length > 1 && count != Integer.parseInt(args[1])) { println 'Unexpected node count: ' + count; System.exit(2) }
println 'FreeMind 1.0.1 native parser loaded ' + count + ' nodes.'
System.exit(0)
